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
  /\b(this|these|page|site|website|web ?site|screen|section|font|fonts|typeface|typography|colou?rs?|button|buttons|header|heading|headline|hero|layout|spacing|padding|margin|review|design|look|looks|image|images|photo|text|menu|nav|navigation|footer|cta|ux|ui|card|cards|form|contrast|hierarchy|alignment|grid|icon|icons|logo|screen ?shot|figma|frame|frames|layer|layers|component|components|variant|auto ?layout|artboard|mockup|wireframe)\b/i;

// Words that say which one they mean.
const MEANS_FIGMA = /\b(figma|frame|frames|layer|layers|component|components|variant|variants|auto ?layout|artboard|my design|mockup|wireframe)\b/i;
const MEANS_WEB = /\b(website|web ?site|web ?page|site|browser|chrome|url|online|live page)\b/i;

const WEB_TOOL =
  {
    name: "look_at_webpage",
    description:
      "Look at the web page open in the user's Chrome browser right now. Returns the page address, " +
      "a list of visible elements (each with an id like w12, its text, position, size, font, colours, " +
      "contrast and spacing), the fonts the page loaded, and a screenshot of what the user sees. " +
      "Use it whenever the user asks about the page they are looking at and you don't have a fresh view of it.",
  };

const FIGMA_TOOL = {
  name: "look_at_figma",
  description:
    "Look at the design open in the user's Figma right now: their selection, or the frames on screen if nothing is selected. " +
    "Returns the layer tree (each layer with an id like 12:34, its name, type, position and size, text and font, fills, " +
    "styles and variables, auto-layout direction/gap/padding, component info) and a picture of it. " +
    "Use it whenever the user asks about their Figma design and you don't have a fresh view of it.",
};

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
    const tools = [];
    if (parts.connected("browser")) tools.push(WEB_TOOL);
    if (parts.connected("figma")) tools.push(FIGMA_TOOL);
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

  /** Looks at Figma. Returns Gemini parts: the layer description and a picture. */
  async function lookAtFigma() {
    broadcast({ type: "looking", surface: "figma" });
    try {
      const design = await parts.call("figma", "figma.snapshot", {}, 20000);
      const result = [{ text: design.text }];
      if (design.screenshot) result.push({ inlineData: { mimeType: "image/jpeg", data: design.screenshot } });
      console.log(`  Looked at Figma "${design.file}" (${design.count} layers${design.screenshot ? ", with picture" : ""})`);
      return result;
    } catch (error) {
      return [{ text: `Couldn't look at Figma: ${error.message}` }];
    }
  }

  /** Which one the user means: Chrome ("browser") or Figma. */
  function surfaceFor(text) {
    const web = parts.connected("browser");
    const fig = parts.connected("figma");
    if (fig && MEANS_FIGMA.test(text) && !MEANS_WEB.test(text)) return "figma";
    if (web && MEANS_WEB.test(text) && !MEANS_FIGMA.test(text)) return "browser";
    return parts.activeSurface();
  }

  async function runTool(call) {
    if (call.name === "look_at_webpage" || call.name === "look_at_figma") {
      const [description, ...images] = call.name === "look_at_figma" ? await lookAtFigma() : await lookAtWebpage();
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
      const surface = ABOUT_SCREEN.test(text) ? surfaceFor(text) : null;
      if (surface) {
        const [description, ...images] = surface === "figma" ? await lookAtFigma() : await lookAtWebpage();
        const where = surface === "figma" ? "their Figma design" : "the web page in Chrome";
        userParts.push({ text: `[What the user is looking at right now: ${where}]\n` + description.text }, ...images);
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
