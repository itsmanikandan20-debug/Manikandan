// The agent: one conversation shared by every helper window.
// Later steps add tools (browser, Figma, screenshots) and the approval gate here.
import { AiError, listChatModels, rankModels, streamChat } from "../ai/gemini.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const MAX_HISTORY = 40; // messages kept for context
const MAX_MODELS_TO_TRY = 4; // when Google is busy, try up to this many models
const RETRY_DELAY_MS = 1500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createAgent({ broadcast }) {
  /** @type {{ role: "user" | "model", text: string }[]} */
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
   * Streams one reply. When Google is busy (or a model hits its free limit),
   * waits and retries once, then moves on to the next model. Once text has
   * started arriving, it doesn't switch, so answers never get mixed up.
   */
  async function* streamReply() {
    let lastError;
    for (const model of await ensureModels()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let started = false;
        try {
          for await (const piece of streamChat({
            key: process.env.GEMINI_API_KEY,
            model,
            system: SYSTEM_PROMPT,
            messages: history,
          })) {
            started = true;
            yield piece;
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

  async function handleUserText(text) {
    text = String(text || "").trim();
    if (!text) return;
    if (!process.env.GEMINI_API_KEY) {
      broadcast({ type: "error", message: "Add your free Gemini key first (the key button at the top)." });
      return;
    }
    if (busy) {
      broadcast({ type: "error", message: "One moment, I'm still answering." });
      return;
    }

    busy = true;
    history.push({ role: "user", text });
    broadcast({ type: "message", role: "user", text });
    broadcast({ type: "agent_start" });

    let reply = "";
    try {
      for await (const piece of streamReply()) {
        reply += piece;
        broadcast({ type: "agent_delta", text: piece });
      }
      if (!reply.trim()) reply = "Sorry, I didn't get an answer back. Could you say that again?";
      history.push({ role: "model", text: reply });
    } catch (error) {
      history.pop(); // forget the question that failed, so it can be asked again
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
    reset() {
      history = [];
      broadcast({ type: "history", messages: [] });
    },
    history: () => history.map((m) => ({ role: m.role === "model" ? "agent" : "user", text: m.text })),
    status: () => ({ hasKey: Boolean(process.env.GEMINI_API_KEY), model: models?.[0] || null, busy }),
    forgetModel() {
      models = null;
    },
  };
}
