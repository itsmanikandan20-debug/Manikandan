// Gemini Live: a real-time voice conversation, like a phone call.
// Your voice goes to Google as audio and the answer comes back as a natural human voice
// (no robotic text-to-speech). Google notices when you start talking and stops by itself.
// Uses the same free Gemini key. Docs: https://ai.google.dev/gemini-api/docs/live
import WebSocket from "ws";
import { AiError } from "./gemini.js";

const BASE_URL = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const LIVE_URL =
  process.env.GEMINI_LIVE_URL ||
  `${BASE_URL.replace(/^http/, "ws").replace(/\/v1\w*$/, "")}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;

/** Voices Google offers for live calls. */
export const LIVE_VOICES = ["Aoede", "Kore", "Leda", "Zephyr", "Puck", "Charon", "Fenrir", "Orus"];

/**
 * The best live voice model for this key (names change over time, so they're looked up).
 * "Native audio" models sound the most human. Returns null if there's none.
 */
export async function pickLiveModel(key) {
  if (process.env.GEMINI_LIVE_MODEL) return process.env.GEMINI_LIVE_MODEL;
  const names = [];
  let pageToken = "";
  do {
    const response = await fetch(`${BASE_URL}/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`, {
      headers: { "x-goog-api-key": key },
    });
    if (!response.ok) throw new AiError(`Google's AI service returned an error (${response.status}).`, { status: response.status });
    const data = await response.json();
    for (const model of data.models || []) {
      if ((model.supportedGenerationMethods || []).includes("bidiGenerateContent")) names.push(model.name.replace(/^models\//, ""));
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  const score = (name) =>
    (/native-audio/i.test(name) ? 100 : 0) +
    (/flash/i.test(name) ? 20 : 0) -
    (/preview|exp/i.test(name) ? 5 : 0) -
    (/thinking|tts/i.test(name) ? 50 : 0) +
    Number((name.match(/(\d+(?:\.\d+)?)/) || [])[1] || 0);
  names.sort((a, b) => score(b) - score(a) || b.localeCompare(a));
  return names[0] || null;
}

/**
 * Opens a live call. Returns { sendAudio, sendText, sendToolResponse, close }.
 * events: onReady, onAudio(base64 PCM 24 kHz), onInterrupted, onHeard(text), onSaid(text),
 *         onTurnDone, onToolCalls([{ id, name, args }]), onGoAway, onClose(reason)
 */
export function openLiveCall({ key, model, system, tools, voice, events }) {
  const socket = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(key)}`);
  let ready = false;

  const send = (message) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  socket.on("open", () => {
    const setup = {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || LIVE_VOICES[0] } } },
      },
      systemInstruction: { parts: [{ text: system }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Long calls: older parts of the conversation are summarised instead of ending the call.
      contextWindowCompression: { slidingWindow: {} },
    };
    if (tools && tools.length) {
      setup.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? { parameters: t.parameters } : {}) })) }];
    }
    send({ setup });
  });

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.setupComplete) {
      ready = true;
      events.onReady && events.onReady();
      return;
    }
    const content = message.serverContent;
    if (content) {
      if (content.interrupted) events.onInterrupted && events.onInterrupted();
      for (const part of (content.modelTurn && content.modelTurn.parts) || []) {
        if (part.inlineData && part.inlineData.data) events.onAudio && events.onAudio(part.inlineData.data, part.inlineData.mimeType || "");
      }
      if (content.inputTranscription && content.inputTranscription.text) events.onHeard && events.onHeard(content.inputTranscription.text);
      if (content.outputTranscription && content.outputTranscription.text) events.onSaid && events.onSaid(content.outputTranscription.text);
      if (content.turnComplete) events.onTurnDone && events.onTurnDone();
    }
    if (message.toolCall && message.toolCall.functionCalls) {
      events.onToolCalls && events.onToolCalls(message.toolCall.functionCalls.map((c) => ({ id: c.id, name: c.name, args: c.args || {} })));
    }
    if (message.goAway) events.onGoAway && events.onGoAway();
  });

  socket.on("error", (error) => {
    events.onClose && events.onClose(ready ? `the call dropped (${error.message})` : `couldn't start (${error.message})`, !ready);
    events.onClose = null;
  });
  socket.on("close", (code, reason) => {
    const why = String(reason || "").slice(0, 200);
    events.onClose && events.onClose(why || `closed (${code})`, !ready);
    events.onClose = null;
  });

  return {
    isReady: () => ready,
    sendAudio(base64) {
      if (ready) send({ realtimeInput: { audio: { data: base64, mimeType: "audio/pcm;rate=16000" } } });
    },
    /** Something typed, or a note from Design Agent: the AI answers it out loud. */
    sendText(text) {
      if (ready) send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
    },
    sendToolResponse(functionResponses) {
      send({ toolResponse: { functionResponses } });
    },
    close() {
      events.onClose = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}
