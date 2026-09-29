// Talks to Google's free Gemini API.
// Docs: https://ai.google.dev/api  (key from https://aistudio.google.com/apikey)

const BASE_URL = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

/**
 * A friendly error the helper window can show as-is.
 * "retryable" means trying again, or with another model, may work (busy, limit, missing model).
 */
export class AiError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

async function request(path, key, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { "content-type": "application/json", "x-goog-api-key": key, ...options.headers },
    });
  } catch {
    throw new AiError("I can't reach Google's AI service. Please check your internet connection.");
  }
  if (response.ok) return response;

  const body = await response.text();
  if (response.status === 400 && body.includes("API_KEY_INVALID")) {
    throw new AiError("That Gemini key doesn't work. Please copy it again from aistudio.google.com/apikey.");
  }
  if (response.status === 403) {
    throw new AiError("Google refused this key. Make sure you copied the whole key from aistudio.google.com/apikey.");
  }
  const status = response.status;
  if (status === 429) {
    throw new AiError("The free Gemini limit was reached. Wait a minute and try again.", { status, retryable: true });
  }
  if (status === 404) {
    throw new AiError("That Gemini model isn't available right now.", { status, retryable: true });
  }
  if (status >= 500) {
    throw new AiError("Google's free AI is very busy right now. Wait a moment and try again.", { status, retryable: true });
  }
  throw new AiError(`Google's AI service returned an error (${status}). Try again in a moment.`, { status });
}

/** Lists models this key may use for chat. */
export async function listChatModels(key) {
  const names = [];
  let pageToken = "";
  do {
    const response = await request(`/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`, key);
    const data = await response.json();
    for (const model of data.models || []) {
      if ((model.supportedGenerationMethods || []).includes("generateContent")) {
        names.push(model.name.replace(/^models\//, ""));
      }
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return names;
}

/**
 * Orders the available models from best to backup. The newest general-purpose
 * "flash" models come first (fast, and free on the free tier), then "flash-lite"
 * models as backups for when Google is busy. Model names change over time, so we
 * choose from what Google says is available instead of hard-coding one.
 */
export function rankModels(names) {
  const special = /(tts|image|live|audio|embed|thinking|exp|learnlm|robotics|computer)/i;
  const ranked = names
    .map((name) => ({ name, match: name.match(/^gemini-(\d+(?:\.\d+)?)-flash(.*)$/) }))
    .filter(({ name, match }) => match && !special.test(name))
    .map(({ name, match }) => ({
      name,
      version: Number(match[1]),
      lite: /lite/.test(match[2]),
      preview: /preview/.test(match[2]),
      extra: match[2],
    }))
    .sort((a, b) =>
      a.lite - b.lite ||                 // full flash before lite
      a.preview - b.preview ||           // stable before preview
      b.version - a.version ||           // newest version first
      a.extra.length - b.extra.length)   // "gemini-X-flash" before dated variants
    .map((m) => m.name);
  if (ranked.length) return ranked;
  const flash = names.filter((name) => /flash/.test(name));
  return flash.length ? flash : names.slice(0, 1);
}

export function pickModel(names) {
  return rankModels(names)[0];
}

/**
 * Streams a reply. Yields text pieces as they arrive.
 * messages: [{ role: "user" | "model", text }]
 */
export async function* streamChat({ key, model, system, messages, signal }) {
  const response = await request(`/models/${model}:streamGenerateContent?alt=sse`, key, {
    method: "POST",
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { temperature: 0.7 },
    }),
  });

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      let data;
      try {
        data = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) if (part.text && !part.thought) yield part.text;
    }
  }
}
