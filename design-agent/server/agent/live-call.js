// The phone-call voice: connects the helper window's microphone and speaker to Gemini Live.
// The helper window sends your voice (16 kHz audio) over its WebSocket; the answer's audio
// (24 kHz) goes back the same way. Tools (looking at Chrome/Figma, changes, search…) are the
// same ones the typed chat uses.
import { openLiveCall, pickLiveModel, LIVE_VOICES } from "../ai/live.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { classifyReply } from "./approvals.js";

const LIVE_NOTE = `

This is a live voice call: you hear the user directly and answer with your own voice.
- Talk like a friendly colleague on a phone call: natural, clear, short (usually one or two sentences). The user can interrupt you any time.
- Your pointer works differently on a call: call point_at with an element or layer id right before you talk about it. Ignore the [[marker]] instructions above.
- When a tool takes a moment (looking, searching, designing), you can say two or three words first, like "One sec."
- Look before you talk about the screen: when they ask about "this page" or their design, call look_at_webpage or look_at_figma first.`;

const POINT_TOOL = {
  name: "point_at",
  description:
    "Move your orange pointer to a web page element (like w12), a Figma layer (like 12:34), or the gap between two (w4-w5). " +
    "Silent and instant. Call it right before you talk about that thing. Use ids from your latest look.",
  parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
};

export function createLiveCalls({ agent, pointAt }) {
  let model = null; // looked up once

  /** One call per helper window. */
  return function callFor(socket) {
    let call = null;
    let heard = ""; // what you said this turn
    let said = ""; // what it said this turn
    let answerStarted = false;
    let voiceName = LIVE_VOICES[0];
    let restarting = false;

    const tell = (message) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    function finishTurn() {
      if (heard.trim() || said.trim()) agent.remember(heard.trim(), said.trim());
      tell({ type: "live_turn_done" });
      heard = "";
      said = "";
      answerStarted = false;
    }

    /** Your "yes" / "no" / "undo" is decided by code, never by the AI (same as typed chat). */
    function checkReply() {
      const answer = classifyReply(heard);
      const waiting = agent.pendingApproval();
      if (waiting && answer === "yes") agent.approve(waiting.id);
      else if (waiting && answer === "no") agent.reject(waiting.id);
    }

    async function start(options = {}) {
      if (call) return;
      if (options.voice && LIVE_VOICES.includes(options.voice)) voiceName = options.voice;
      const key = process.env.GEMINI_API_KEY;
      if (!key) return tell({ type: "live_failed", reason: "no Gemini key", fallback: true });
      try {
        model = model || (await pickLiveModel(key));
      } catch (error) {
        return tell({ type: "live_failed", reason: error.message, fallback: true });
      }
      if (!model) return tell({ type: "live_failed", reason: "no live voice model for this key", fallback: true });

      const earlier = agent.recentConversation();
      const system = SYSTEM_PROMPT + LIVE_NOTE + (earlier ? `\n\nThe conversation so far (continue it):\n${earlier}` : "");
      call = openLiveCall({
        key,
        model,
        system,
        voice: voiceName,
        tools: [POINT_TOOL, ...agent.liveTools()],
        events: {
          onReady() {
            if (!restarting) console.log(`  Live call started (${model}, voice ${voiceName}).`);
            restarting = false;
            tell({ type: "live_ready", voice: voiceName });
          },
          onAudio(base64) {
            if (!answerStarted) {
              answerStarted = true;
              checkReply();
            }
            if (socket.readyState === socket.OPEN) socket.send(Buffer.from(base64, "base64"));
          },
          onInterrupted() {
            tell({ type: "live_interrupted" });
          },
          onHeard(text) {
            if (answerStarted) finishTurn(); // you started a new turn
            heard += text;
            agent.setRequest(heard);
            tell({ type: "live_heard", text: heard.trim() });
          },
          onSaid(text) {
            said += text;
            tell({ type: "live_said", text: said.trim() });
          },
          onTurnDone() {
            if (!answerStarted) checkReply();
            finishTurn();
          },
          async onToolCalls(calls) {
            if (!answerStarted) {
              answerStarted = true;
              checkReply();
            }
            const responses = [];
            for (const c of calls) {
              if (c.name === "point_at") {
                pointAt(String((c.args || {}).id || ""));
                responses.push({ id: c.id, name: c.name, response: { ok: true } });
                continue;
              }
              let response;
              try {
                response = await agent.runToolForLive(c);
              } catch (error) {
                response = { error: error.message };
              }
              if (!response || typeof response !== "object" || Array.isArray(response)) response = { result: response };
              responses.push({ id: c.id, name: c.name, response });
            }
            if (call) call.sendToolResponse(responses);
          },
          onGoAway() {
            // Google ends calls after a while: quietly start a fresh one that continues the conversation.
            restarting = true;
            setTimeout(() => {
              if (!call) return;
              stop(true);
              start();
            }, 1500);
          },
          onClose(reason, neverStarted) {
            call = null;
            if (restarting) return;
            console.log(`  Live call ${neverStarted ? "couldn't start" : "ended"}: ${reason}`);
            tell({ type: "live_failed", reason, fallback: neverStarted });
          },
        },
      });
    }

    function stop(quiet = false) {
      if (!call) return;
      const ending = call;
      call = null;
      ending.close();
      if (heard.trim() || said.trim()) finishTurn();
      if (!quiet) console.log("  Live call ended.");
    }

    return {
      start,
      stop: () => stop(),
      audio(buffer) {
        if (call) call.sendAudio(Buffer.from(buffer).toString("base64"));
      },
      text(text) {
        if (!call) return false;
        agent.setRequest(text);
        heard = text;
        tell({ type: "live_heard", text });
        call.sendText(text);
        return true;
      },
      /** A note from Design Agent (for example "the change was applied"), answered out loud. */
      note(text) {
        if (call) call.sendText(`[Design Agent note, not from the user: ${text}]`);
      },
      isOn: () => Boolean(call),
    };
  };
}
