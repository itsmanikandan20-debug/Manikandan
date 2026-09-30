// Talks to Groq, the backup AI (used when Gemini's free allowance runs out or it's busy).
// Docs: https://console.groq.com/docs  (free key from https://console.groq.com/keys)
// Groq speaks the OpenAI chat format, so this file translates Design Agent's conversation
// (kept in Gemini's format) to it and back.
import { AiError } from "./gemini.js";

const BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";

async function request(path, key, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...options.headers },
    });
  } catch {
    throw new AiError("I can't reach Groq (the backup AI). Please check your internet connection.", { retryable: true });
  }
  if (response.ok) return response;
  const body = await response.text();
  const status = response.status;
  if (status === 401) throw new AiError("That Groq key doesn't work. Copy it again from console.groq.com/keys.", { status });
  if (status === 429) {
    const perDay = /per day|\bRPD\b|\bTPD\b/i.test(body);
    const wait = Number(response.headers.get("retry-after")) || parseFloat((body.match(/try again in ([\d.]+)s/i) || [])[1]) || 30;
    throw new AiError(perDay ? "The backup AI's free daily allowance is used up too." : `The backup AI's free per-minute limit was reached. Try again in ${Math.ceil(wait)} seconds.`, {
      status, retryable: true, limit: perDay ? "day" : "minute", retryAfter: wait,
    });
  }
  if (status === 404 || (status === 400 && /model/i.test(body) && /decommission|not found|does not exist/i.test(body))) {
    throw new AiError("That Groq model isn't available any more.", { status: 404, retryable: true });
  }
  if (status >= 500) throw new AiError("Groq is busy right now.", { status, retryable: true });
  throw new AiError(`Groq returned an error (${status}).`, { status, retryable: status === 400 });
}

/**
 * Picks the best Groq model for Design Agent from what's available now
 * (model names change over time). Models that can see images come first.
 */
export async function pickGroqModel(key) {
  const response = await request("/models", key);
  const ids = ((await response.json()).data || []).filter((m) => m.active !== false).map((m) => m.id);
  const usable = ids.filter((id) => !/whisper|guard|tts|playai|distil|embed|compound|orpheus/i.test(id));
  const prefer = [/llama-4-maverick/i, /llama-4-scout/i, /vision|-vl\b|\bvl-/i, /gpt-oss-120b/i, /llama-3\.3-70b/i, /qwen/i, /gpt-oss/i, /llama/i];
  for (const pattern of prefer) {
    const match = usable.find((id) => pattern.test(id));
    if (match) return match;
  }
  return usable[0] || null;
}

export function canSeeImages(model) {
  return /llama-4|vision|-vl\b|\bvl-/i.test(model || "");
}

/** Gemini-format conversation → OpenAI-format messages. */
function toMessages(system, contents, seesImages) {
  const messages = [{ role: "system", content: system }];
  let lastCallIds = [];
  let callCounter = 0;
  for (const turn of contents) {
    const texts = [];
    const images = [];
    const calls = [];
    const results = [];
    for (const part of turn.parts || []) {
      if (part.text && !part.thought) texts.push(part.text);
      else if (part.inlineData) images.push(part.inlineData);
      else if (part.functionCall) calls.push(part);
      else if (part.functionResponse) results.push(part.functionResponse);
    }
    if (turn.role === "model") {
      lastCallIds = calls.map((c) => c.id || `call_${++callCounter}`);
      const message = { role: "assistant", content: texts.join("") || null };
      if (calls.length) {
        message.tool_calls = calls.map((c, i) => ({
          id: lastCallIds[i],
          type: "function",
          function: { name: c.functionCall.name, arguments: JSON.stringify(c.functionCall.args || {}) },
        }));
      }
      if (message.content || message.tool_calls) messages.push(message);
      continue;
    }
    // Tool results answer the calls of the previous assistant message, in order.
    results.forEach((r, i) => {
      messages.push({ role: "tool", tool_call_id: lastCallIds[i] || `call_${++callCounter}`, content: JSON.stringify(r.response) });
    });
    if (texts.length || images.length) {
      const content = [];
      if (texts.length) content.push({ type: "text", text: texts.join("\n") });
      if (seesImages) {
        for (const img of images.slice(0, 4)) content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
      } else if (images.length) {
        content.push({ type: "text", text: "(A picture was attached, but this backup AI can't see pictures; rely on the text description.)" });
      }
      messages.push({ role: "user", content: seesImages ? content : content.map((c) => c.text).join("\n") });
    }
  }
  return messages;
}

/** Streams one model turn from Groq. Yields the same events as gemini.js streamChat. */
export async function* streamGroq({ key, model, system, contents, tools }) {
  const body = {
    model,
    messages: toMessages(system, contents, canSeeImages(model)),
    temperature: 0.8,
    stream: true,
  };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters || { type: "object", properties: {} } },
    }));
  }
  const response = await request("/chat/completions", key, { method: "POST", body: JSON.stringify(body) });

  const decoder = new TextDecoder();
  let buffer = "";
  const calls = []; // tool calls arrive in pieces: [{ id, name, args }]
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let data;
      try {
        data = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = data.choices?.[0]?.delta || {};
      if (delta.content) yield { part: { text: delta.content }, text: delta.content };
      for (const piece of delta.tool_calls || []) {
        const call = (calls[piece.index] = calls[piece.index] || { id: "", name: "", args: "" });
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.name += piece.function.name;
        if (piece.function?.arguments) call.args += piece.function.arguments;
      }
    }
  }
  for (const call of calls.filter(Boolean)) {
    let args = {};
    try {
      args = call.args ? JSON.parse(call.args) : {};
    } catch {
      args = {};
    }
    yield { part: { functionCall: { name: call.name, args }, id: call.id }, call: { name: call.name, args } };
  }
}
