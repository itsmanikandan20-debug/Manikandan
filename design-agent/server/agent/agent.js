// The agent: one conversation shared by every helper window.
// Later steps add tools (browser, Figma, screenshots) and the approval gate here.
import { AiError, listChatModels, pickModel, streamChat } from "../ai/gemini.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const MAX_HISTORY = 40; // messages kept for context

export function createAgent({ broadcast }) {
  /** @type {{ role: "user" | "model", text: string }[]} */
  let history = [];
  let model = null;
  let busy = false;

  async function ensureModel() {
    if (process.env.GEMINI_MODEL) return (model = process.env.GEMINI_MODEL);
    if (!model) model = pickModel(await listChatModels(process.env.GEMINI_API_KEY));
    if (!model) throw new AiError("No Gemini chat model is available for this key.");
    return model;
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
      await ensureModel();
      for await (const piece of streamChat({
        key: process.env.GEMINI_API_KEY,
        model,
        system: SYSTEM_PROMPT,
        messages: history,
      })) {
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
    status: () => ({ hasKey: Boolean(process.env.GEMINI_API_KEY), model, busy }),
    forgetModel() {
      model = null;
    },
  };
}
