// The agent: one conversation shared by every helper window.
// Loop per question: OBSERVE (look at the screen when the question is about it)
// → UNDERSTAND and DISCUSS (Gemini answers, and may call tools to look again).
// Later steps add more tools (pointer, Figma, screenshots) and the approval gate here.
import { AiError, listChatModels, rankModels, streamChat } from "../ai/gemini.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const MAX_HISTORY = 40; // messages kept for context (always an even number: question + answer)
const MAX_MODELS_TO_TRY = 4; // when Google is busy, try up to this many models
const MAX_TOOL_ROUNDS = 3;
const RETRY_DELAY_MS = 1500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Questions that are probably about what's on screen. When one of these words
// appears, we look at the page right away instead of waiting for the AI to ask,
// which saves a round trip and makes the answer faster.
const ABOUT_SCREEN =
  /\b(this|these|page|site|website|web ?site|screen|section|font|fonts|typeface|typography|colou?rs?|button|buttons|header|heading|headline|hero|layout|spacing|padding|margin|review|design|look|looks|image|images|photo|text|menu|nav|navigation|footer|cta|ux|ui|card|cards|form|contrast|hierarchy|alignment|grid|icon|icons|logo|screen ?shot)\b/i;

const TOOLS = [
  {
    name: "look_at_webpage",
    description:
      "Look at the web page open in the user's Chrome browser right now. Returns the page address, " +
      "a list of visible elements (each with an id like w12, its text, position, size, font, colours, " +
      "contrast and spacing), the fonts the page loaded, and a screenshot of what the user sees. " +
      "Use it whenever the user asks about the page they are looking at and you don't have a fresh view of it.",
  },
];

export function createAgent({ broadcast, parts }) {
  /** Conversation in Gemini's format: [{ role: "user" | "model", parts: [{ text }] }] */
  let history = [];
  let models = null; // best first; the one that last worked is moved to the front
  let busy = false;

  async function ensureModels() {
    if (process.env.GEMINI_MODEL) return (models = [process.env.GEMINI_MODEL]);
    if (!models) models = rankModels(await listChatModels(process.env.GEMINI_API_KEY)).slice(0, MAX_MODELS_TO_TRY);
    if (!models.length) throw new AiError("No Gemini chat model is available for this key.");
    return models;
  }

  /**
   * Streams one model turn. When Google is busy (or a model hits its free limit),
   * waits and retries once, then moves on to the next model. Once output has
   * started arriving, it doesn't switch, so answers never get mixed up.
   */
  async function* streamTurn(contents) {
    const tools = parts.connected("browser") ? TOOLS : [];
    let lastError;
    for (const model of await ensureModels()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let started = false;
        try {
          for await (const event of streamChat({
            key: process.env.GEMINI_API_KEY,
            model,
            system: SYSTEM_PROMPT,
            contents,
            tools,
          })) {
            if (event.text || event.call) started = true;
            yield event;
          }
          if (models[0] !== model) models = [model, ...models.filter((m) => m !== model)];
          return;
        } catch (error) {
          if (started || !(error instanceof AiError) || !error.retryable) throw error;
          lastError = error;
          console.log(`  Gemini ${model} answered ${error.status}; ${attempt === 0 ? "retrying" : "trying another model"}...`);
          if (attempt === 0 && error.status !== 404) await wait(RETRY_DELAY_MS);
          else break;
        }
      }
    }
    throw lastError;
  }

  // ---------- tools ----------

  /** Looks at the Chrome tab. Returns Gemini parts: the page description and the screenshot. */
  async function lookAtWebpage() {
    broadcast({ type: "looking", surface: "browser" });
    try {
      const page = await parts.call("browser", "web.snapshot", {});
      const result = [{ text: page.text }];
      if (page.screenshot) result.push({ inlineData: { mimeType: "image/jpeg", data: page.screenshot } });
      console.log(`  Looked at ${page.url} (${page.count} elements${page.screenshot ? ", with screenshot" : ""})`);
      return result;
    } catch (error) {
      return [{ text: `Couldn't look at the page: ${error.message}` }];
    }
  }

  async function runTool(call) {
    if (call.name === "look_at_webpage") {
      const [description, ...images] = await lookAtWebpage();
      return { response: { result: description.text }, extra: images };
    }
    return { response: { error: `Unknown tool ${call.name}` }, extra: [] };
  }

  // ---------- one question ----------

  async function handleUserText(text) {
    text = String(text || "").trim();
    if (!text) return;
    if (!process.env.GEMINI_API_KEY) {
      broadcast({ type: "error", message: "Add your free Gemini key first (Settings → Change AI key)." });
      return;
    }
    if (busy) {
      broadcast({ type: "error", message: "One moment, I'm still answering." });
      return;
    }

    busy = true;
    broadcast({ type: "message", role: "user", text });
    broadcast({ type: "agent_start" });

    let reply = "";
    const startedAt = Date.now();
    try {
      // OBSERVE: if the question is about the screen, look first.
      const userParts = [{ text }];
      if (parts.connected("browser") && ABOUT_SCREEN.test(text)) {
        const [description, ...images] = await lookAtWebpage();
        userParts.push({ text: "[What the user is looking at right now]\n" + description.text }, ...images);
      }
      const contents = [...history, { role: "user", parts: userParts }];

      // UNDERSTAND / DISCUSS: stream the answer; run any tools it asks for.
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const modelParts = [];
        const calls = [];
        for await (const event of streamTurn(contents)) {
          modelParts.push(event.part);
          if (event.call) calls.push(event.call);
          if (event.text) {
            if (!reply) console.log(`  First words after ${((Date.now() - startedAt) / 1000).toFixed(1)} s (${models?.[0]})`);
            reply += event.text;
            broadcast({ type: "agent_delta", text: event.text });
          }
        }
        if (!calls.length || round === MAX_TOOL_ROUNDS) break;

        contents.push({ role: "model", parts: modelParts });
        const responses = [];
        const extras = [];
        for (const call of calls) {
          const { response, extra } = await runTool(call);
          responses.push({ functionResponse: { name: call.name, response } });
          extras.push(...extra);
        }
        contents.push({ role: "user", parts: [...responses, ...extras] });
        if (reply && !/\s$/.test(reply)) {
          reply += " ";
          broadcast({ type: "agent_delta", text: " " });
        }
      }

      if (!reply.trim()) {
        reply = "Sorry, I didn't get an answer back. Could you say that again?";
        broadcast({ type: "agent_delta", text: reply });
      }
      // Keep only the words in the history; screenshots are large and get old quickly.
      history.push({ role: "user", parts: [{ text }] }, { role: "model", parts: [{ text: reply }] });
    } catch (error) {
      const message = error instanceof AiError ? error.message : "Something went wrong while answering. Try again.";
      if (!(error instanceof AiError)) console.error(error);
      broadcast({ type: "error", message });
    } finally {
      history = history.slice(-MAX_HISTORY);
      broadcast({ type: "agent_done", text: reply });
      busy = false;
    }
  }

  return {
    handleUserText,
    /** Look up the available models in the background, so the first answer is quick. */
    warmUp() {
      if (process.env.GEMINI_API_KEY) ensureModels().catch(() => {});
    },
    reset() {
      history = [];
      broadcast({ type: "history", messages: [] });
    },
    history: () =>
      history.map((m) => ({
        role: m.role === "model" ? "agent" : "user",
        text: m.parts.map((p) => p.text || "").join(""),
      })),
    status: () => ({ hasKey: Boolean(process.env.GEMINI_API_KEY), model: models?.[0] || null, busy }),
    forgetModel() {
      models = null;
    },
  };
}
