// Backup AIs, used in order when Gemini's free allowance runs out, it's busy, or it refuses.
// They all speak the OpenAI chat format, so one client works for all of them. This file
// translates Design Agent's conversation (kept in Gemini's format) to that format and back.
// Every key is optional; each one added is one more service to fall back on.
import { AiError } from "./gemini.js";

/** The backup services, in the order they're tried. */
export const BACKUPS = [
  {
    id: "groq",
    name: "Groq",
    envKey: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    keysUrl: "https://console.groq.com/keys",
    prefer: [/llama-4-maverick/i, /llama-4-scout/i, /vision|-vl\b|\bvl-/i, /gpt-oss-120b/i, /llama-3\.3-70b/i, /qwen/i, /gpt-oss/i, /llama/i],
    skip: /whisper|guard|tts|playai|distil|embed|compound|orpheus/i,
  },
  {
    id: "cerebras",
    name: "Cerebras",
    envKey: "CEREBRAS_API_KEY",
    baseUrl: "https://api.cerebras.ai/v1",
    keysUrl: "https://cloud.cerebras.ai",
    prefer: [/gpt-oss-120b/i, /qwen-3-235b/i, /llama-4/i, /qwen/i, /llama-3\.3-70b|llama3\.3-70b/i, /llama/i],
    skip: /embed|guard/i,
  },
  {
    id: "mistral",
    name: "Mistral",
    envKey: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
    keysUrl: "https://console.mistral.ai/api-keys",
    prefer: [/^mistral-medium-latest$/i, /^mistral-large-latest$/i, /^pixtral-large-latest$/i, /^mistral-small-latest$/i, /^mistral-medium/i, /^mistral-large/i, /^mistral-small/i],
    skip: /embed|moderation|ocr|codestral|devstral|voxtral|saba|ministral-3b/i,
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    envKey: "NVIDIA_API_KEY",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keysUrl: "https://build.nvidia.com",
    prefer: [/llama-4-maverick/i, /llama-4-scout/i, /qwen.*vl/i, /llama-3\.3-70b-instruct/i, /gpt-oss-120b/i, /qwen3.*235b/i, /mistral-large/i, /llama-3\.1-70b-instruct/i],
    skip: /embed|rerank|parakeet|whisper|canary|tts|magpie|flux|stable|sdxl|guard|safety|reward|clip|retriev|detect|ocr|paddle|cosmos|bio|diffusion|nemoretriever|audio2|fourcast|molmim|esm|alphafold|vista|deplot|kosmos|neva|fuyu|paligemma|streampetr|ising/i,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    keysUrl: "https://openrouter.ai/keys",
    prefer: [/gemini.*:free/i, /llama-4-maverick.*:free/i, /qwen.*vl.*:free/i, /mistral-small.*:free/i, /llama.*:free/i, /qwen.*:free/i, /deepseek.*:free/i, /:free$/i],
    skip: /embed|guard/i,
    onlyFree: true,
  },
];

export const backupById = (id) => BACKUPS.find((b) => b.id === id);

function baseUrlOf(backup) {
  return process.env[`${backup.id.toUpperCase()}_BASE_URL`] || backup.baseUrl;
}

async function request(backup, path, key, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrlOf(backup)}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        ...(backup.id === "openrouter" ? { "x-title": "Design Agent" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new AiError(`I can't reach ${backup.name} (a backup AI).`, { retryable: true });
  }
  if (response.ok) return response;
  const body = await response.text();
  const status = response.status;
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    detail = (parsed.error && (parsed.error.message || parsed.error)) || parsed.message || detail;
    if (typeof detail !== "string") detail = JSON.stringify(detail).slice(0, 300);
  } catch {
    // keep the raw text
  }
  if (status === 401 || status === 403) {
    // Retryable: with a broken key here, the next backup can still answer.
    throw new AiError(`That ${backup.name} key doesn't work. Copy it again from ${backup.keysUrl}.`, { status, detail, retryable: true });
  }
  if (status === 429) {
    const perDay = /per day|daily|\bRPD\b|\bTPD\b|free-models-per-day/i.test(body);
    const wait = Number(response.headers.get("retry-after")) || parseFloat((body.match(/try again in ([\d.]+)s/i) || [])[1]) || 30;
    throw new AiError(`${backup.name}'s free ${perDay ? "daily allowance is used up" : "per-minute limit was reached"}.`, {
      status, retryable: true, limit: perDay ? "day" : "minute", retryAfter: wait, detail,
    });
  }
  if (status === 404) throw new AiError(`That ${backup.name} model isn't available any more.`, { status, retryable: true, detail });
  if (status >= 500) throw new AiError(`${backup.name} is busy right now.`, { status, retryable: true, detail });
  throw new AiError(`${backup.name} returned an error (${status}).`, { status, retryable: true, detail });
}

/**
 * Picks the best model this service offers right now (names change over time).
 * Returns { model, vision } or null.
 */
export async function pickBackupModel(backup, key) {
  const response = await request(backup, "/models", key);
  const data = (await response.json()).data || [];
  let models = data
    .filter((m) => m.active !== false && m.id && !backup.skip.test(m.id))
    .map((m) => ({
      id: m.id,
      tools: m.supported_parameters ? m.supported_parameters.includes("tools") : true,
      vision: m.architecture && m.architecture.input_modalities
        ? m.architecture.input_modalities.includes("image")
        : m.capabilities && typeof m.capabilities.vision === "boolean"
          ? m.capabilities.vision
          : null,
    }));
  if (backup.onlyFree) models = models.filter((m) => /:free$/i.test(m.id));
  models = models.filter((m) => m.tools);
  for (const pattern of backup.prefer) {
    const match = models.find((m) => pattern.test(m.id));
    if (match) return { model: match.id, vision: match.vision !== null ? match.vision : guessVision(match.id) };
  }
  return models[0] ? { model: models[0].id, vision: models[0].vision !== null ? models[0].vision : guessVision(models[0].id) } : null;
}

function guessVision(model) {
  return /llama-4|vision|-vl\b|\bvl-|pixtral|gemini|mistral-(medium|small|large)|gpt-4o/i.test(model || "");
}

/** Some services (Mistral) only accept 9-letter tool call ids. */
function callId(n) {
  return `call${String(n).padStart(5, "0")}`.slice(-9);
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
      lastCallIds = calls.map((c) => (c.id && /^[A-Za-z0-9]{9}$/.test(c.id) ? c.id : callId(++callCounter)));
      const message = { role: "assistant", content: texts.join("") || "" };
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
      messages.push({ role: "tool", tool_call_id: lastCallIds[i] || callId(++callCounter), name: r.name, content: JSON.stringify(r.response) });
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

/** Streams one model turn. Yields the same events as gemini.js streamChat. */
export async function* streamBackup({ backup, key, model, vision, system, contents, tools }) {
  const body = {
    model,
    messages: toMessages(system, contents, vision),
    temperature: 0.8,
    stream: true,
  };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters || { type: "object", properties: {} } },
    }));
  }
  const response = await request(backup, "/chat/completions", key, { method: "POST", body: JSON.stringify(body) });

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
      if (data.error) throw new AiError(`${backup.name} stopped: ${data.error.message || "error"}`, { retryable: true });
      const delta = (data.choices && data.choices[0] && data.choices[0].delta) || {};
      const text = typeof delta.content === "string" ? delta.content : "";
      if (text) yield { part: { text }, text };
      for (const piece of delta.tool_calls || []) {
        const index = piece.index !== undefined ? piece.index : calls.length;
        const call = (calls[index] = calls[index] || { id: "", name: "", args: "" });
        if (piece.id) call.id = piece.id;
        if (piece.function && piece.function.name) call.name += piece.function.name;
        if (piece.function && piece.function.arguments) {
          call.args += typeof piece.function.arguments === "string" ? piece.function.arguments : JSON.stringify(piece.function.arguments);
        }
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
