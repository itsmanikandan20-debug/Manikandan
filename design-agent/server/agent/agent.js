// The agent: one conversation shared by every helper window.
// Loop per question: OBSERVE (look at the screen when the question is about it)
// → UNDERSTAND and DISCUSS (Gemini answers, and may call tools to look again).
// → SUGGEST → ASK FOR APPROVAL (the AI can only propose; see approvals.js)
// → ACT (only after the user's yes) → VERIFY (it looks at the result and reports back).
import { AiError, listChatModels, rankModels, streamChat } from "../ai/gemini.js";
import { BACKUPS, pickBackupModel, streamBackup } from "../ai/backups.js";
import { randomUUID } from "node:crypto";
import { SYSTEM_PROMPT } from "./prompt.js";
import { openInChrome, searchWeb } from "../web.js";
import { CHANGE_TOOL, DESIGN_TOOL, classifyReply } from "./approvals.js";

const MAX_HISTORY = 40; // messages kept for context (always an even number: question + answer)
const MAX_MODELS_TO_TRY = 6; // when Google is busy, try up to this many models
const MAX_TOOL_ROUNDS = 3;
const HEDGE_MS = 500; // no answer from one AI within this: ask the next one too
const MAX_PARALLEL = 3; // at most this many AIs asked at the same time

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown when you talk over an answer: the answer just stops (no error message). */
class Stopped extends Error {}

// Questions that are probably about what's on screen. When one of these words
// appears, we look at the page right away instead of waiting for the AI to ask,
// which saves a round trip and makes the answer faster.
const ABOUT_SCREEN =
  /\b(this|these|page|site|website|web ?site|screen|section|font|fonts|typeface|typography|colou?rs?|button|buttons|header|heading|headline|hero|layout|spacing|padding|margin|review|design|look|looks|image|images|photo|text|menu|nav|navigation|footer|cta|ux|ui|card|cards|form|contrast|hierarchy|alignment|grid|icon|icons|logo|screen ?shot|figma|frame|frames|layer|layers|component|components|variant|auto ?layout|artboard|mockup|wireframe|wireframes|sketch|screen|create|build|draw)\b/i;

// Words that say which one they mean.
const MEANS_FIGMA = /\b(figma|frame|frames|layer|layers|component|components|variant|variants|auto ?layout|artboard|my design|mockup|wireframe|wireframes|sketch)\b/i;
// "Create / design / draw a … screen / page / wireframe": a new design, made in Figma.
const DESIGN_REQUEST = /\b(create|design|draw|sketch|wireframe|mock ?up|build|make|generate)\b.*\b(screen|screens|page|pages|wireframe|wireframes|website|app|section|layout|landing|dashboard|form|card|ui|mockup|hero|modal|onboarding|flow)\b/i;
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

const SCREENSHOT_TOOL = {
  name: "take_screenshot",
  description:
    "Take a screenshot of the web page open in the user's Chrome and save it in their screenshot library on this computer. " +
    "Set full_page to true when they ask for the whole page (it scrolls and stitches), otherwise it captures what's visible. " +
    "Doesn't change anything, so no approval is needed.",
  parameters: { type: "object", properties: { full_page: { type: "boolean" } } },
};

const FIND_TOOL = {
  name: "find_in_figma",
  description:
    "Search every page of the open Figma file for layers: screenshots Design Agent placed, other big images (like screenshots the user uploaded), " +
    "or layers whose name contains the words. Returns ids, names and pages. Doesn't change anything.",
  parameters: { type: "object", properties: { query: { type: "string", description: 'For example "screenshot", "apple", "hero section"' } } },
};

const GOTO_TOOL = {
  name: "go_to_figma_layer",
  description:
    "Take the user to a layer in the open Figma file: switch to its page, select it, zoom to it and point at it. " +
    "Doesn't change the design, so no approval is needed.",
  parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
};

const OPEN_FILE_TOOL = {
  name: "open_figma_file",
  description:
    "Open a Figma file the user has used with Design Agent before, by name (opens its link). " +
    "Use when the thing they're looking for is in a different file than the one open.",
  parameters: { type: "object", properties: { file: { type: "string" } }, required: ["file"] },
};

const SEARCH_TOOL = {
  name: "search_web",
  description:
    "Search the internet. Returns results (title, address, snippet), sometimes with a short answer. " +
    "Use it for any question about the world, companies, trends, examples or anything you'd need to look up, " +
    "and to find websites to open.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      count: { type: "number", description: "How many results (default 8, max 20)" },
    },
    required: ["query"],
  },
};

const OPEN_SITES_TOOL = {
  name: "open_websites",
  description:
    "Open web addresses as new tabs in the user's Chrome (up to 15). Use it when they ask you to open a site, " +
    "or to open several sites (find them with search_web first). No approval needed.",
  parameters: {
    type: "object",
    properties: { urls: { type: "array", items: { type: "string" }, description: "Full addresses starting with https://" } },
    required: ["urls"],
  },
};

const MARK_TOOL = {
  name: "mark_issues",
  description:
    "Show your review findings ON the user's screen: draws a numbered, coloured box with a short label on each element or layer " +
    "(UX = purple, UI = blue, Content = green) in Chrome or Figma. Use it whenever you review something or they ask what to correct: " +
    "mark first, then talk through the findings in the same order ('Number 1, a UX issue: ...'). Replaces earlier marks. " +
    "Use ids from your latest look (w12 on web pages, 12:34 in Figma). Doesn't change their design.",
  parameters: {
    type: "object",
    properties: {
      marks: {
        type: "array",
        description: "Most important first, usually 3 to 6",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Element id (w12) or Figma layer id (12:34)" },
            kind: { type: "string", description: "ux (flow, clarity, usability, accessibility), ui (visual: spacing, alignment, type, colour, contrast) or content (copy, wording, spelling, tone)" },
            note: { type: "string", description: "Short label, max about 8 words, e.g. 'CTA label is vague'" },
          },
          required: ["id", "kind", "note"],
        },
      },
    },
    required: ["marks"],
  },
};

const CLEAR_MARKS_TOOL = {
  name: "clear_marks",
  description: "Remove your review marks from the screen (Chrome and Figma). Use when they ask to clear or hide the marks/notes.",
};

const SCREENSHOT_TABS_TOOL = {
  name: "screenshot_tabs",
  description:
    "Take a screenshot of MANY Chrome tabs and (by default) put them all into Figma in a neat row, one frame per site. " +
    "which: 'opened' = the sites you opened with open_websites (default), 'all' = every website tab in their Chrome window. " +
    "full_page true (default) scrolls each page for the whole length. figma_file: optional name of a Figma file that isn't open " +
    "(they're added when it opens). It runs in the background: say it's started, and you'll be told when it's done.",
  parameters: {
    type: "object",
    properties: {
      which: { type: "string", description: "opened or all" },
      full_page: { type: "boolean" },
      put_in_figma: { type: "boolean", description: "Default true" },
      figma_file: { type: "string" },
    },
  },
};

const LIST_SCREENSHOTS_TOOL = {
  name: "list_screenshots",
  description: "List the screenshots saved in the user's library (newest first): id, name, page address, when, and where each was put in Figma.",
};

export function createAgent({ broadcast, parts, captures }) {
  /** Conversation in Gemini's format: [{ role: "user" | "model", parts: [{ text }] }] */
  let history = [];
  let models = null; // best first; the one that last worked is moved to the front
  let busy = false;
  let turnStop = null; // AbortController of the answer being given now (so you can interrupt it)

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
  // Models whose free daily allowance is used up: skipped for a while (it resets at midnight Pacific).
  const usedUpUntil = new Map();
  let answeringModel = null; // the model giving the current answer (for the log)
  // When Gemini is busy or slow, the backups go first for a few minutes (fast answers, like a call).
  let geminiSlowUntil = 0;
  const GEMINI_COOLDOWN_MS = 3 * 60 * 1000;

  // Backup AIs (Groq, Cerebras, Mistral, OpenRouter), used in order when Gemini can't answer.
  const backupModels = new Map(); // id -> { model, vision } once picked
  const hasBackup = () => BACKUPS.some((b) => process.env[b.envKey]);

  async function backupModel(backup) {
    if (!process.env[backup.envKey]) return null;
    if (!backupModels.has(backup.id)) {
      const fixed = process.env[`${backup.id.toUpperCase()}_MODEL`];
      const picked = fixed ? { model: fixed, vision: /vision|vl|llama-4|pixtral|gemini|mistral/i.test(fixed) } : await pickBackupModel(backup, process.env[backup.envKey]);
      if (!picked) return null;
      backupModels.set(backup.id, picked);
    }
    return backupModels.get(backup.id);
  }

  /** Every AI we can try, best first: Gemini models, then each backup that has a key. */
  async function candidates() {
    const list = [];
    if (process.env.GEMINI_API_KEY) {
      try {
        for (const model of await ensureModels()) list.push({ provider: "gemini", model });
      } catch (error) {
        if (!hasBackup()) throw error;
        console.log(`  Gemini isn't answering (${error.message}); using the backup AIs.`);
      }
    }
    for (const backup of BACKUPS) {
      try {
        const picked = await backupModel(backup);
        if (picked) list.push({ provider: backup.id, backup, model: picked.model, vision: picked.vision });
      } catch (error) {
        console.log(`  ${backup.name} (backup) isn't available: ${error.message}`);
      }
    }
    return list;
  }

  /** The tools the AI can use right now (some need Chrome or Figma to be connected). */
  function toolsNow({ all = false } = {}) {
    const tools = [];
    if (all || parts.connected("browser")) tools.push(WEB_TOOL, SCREENSHOT_TOOL, SCREENSHOT_TABS_TOOL);
    tools.push(SEARCH_TOOL, OPEN_SITES_TOOL, LIST_SCREENSHOTS_TOOL);
    if (all || parts.connected("figma")) tools.push(FIGMA_TOOL, FIND_TOOL, GOTO_TOOL, DESIGN_TOOL);
    if (all || parts.connected("browser") || parts.connected("figma")) tools.push(MARK_TOOL, CLEAR_MARKS_TOOL);
    tools.push(CHANGE_TOOL, OPEN_FILE_TOOL); // changes can also be for a file that isn't open yet
    return tools;
  }

  /**
   * Streams one model turn, racing the AIs: the first one starts at once; if it hasn't started
   * answering within `hedgeMs` (0.5 s for talk), the next one is asked too, and so on. Whoever
   * answers first wins and the others are cancelled. Once an answer is coming, it never switches,
   * so answers never get mixed up.
   */
  async function* streamTurn(contents, waitedOnce = false, firstWordsWithinMs = 8000, { stop = null, hedgeMs = HEDGE_MS } = {}) {
    const tools = toolsNow();
    let lastError;
    const all = await candidates();
    if (!all.length) throw new AiError("No AI is set up. Add your free Gemini key in Settings.");
    let available = all.filter((c) => (usedUpUntil.get(`${c.provider}:${c.model}`) || 0) < Date.now());
    if (!available.length) available = all;
    // Gemini's best model first, then the backups (fastest first), then Gemini's other models.
    const gemini = available.filter((c) => !c.backup);
    const backups = available.filter((c) => c.backup);
    let queue = Date.now() < geminiSlowUntil && backups.length
      ? [...backups, ...gemini] // Gemini was slow a moment ago: backups first for a few minutes
      : [...gemini.slice(0, 1), ...backups, ...gemini.slice(1)];

    const minuteWaits = [];
    let skipGemini = false;
    let pulse = null;
    const wake = () => {
      const p = pulse;
      pulse = null;
      if (p) p();
    };
    const running = [];

    const labelOf = (c) => (c.backup ? `Backup AI (${c.backup.name} ${c.model})` : `Gemini ${c.model}`);

    function launch(candidate) {
      const { backup, model } = candidate;
      const controller = new AbortController();
      const attempt = { candidate, label: labelOf(candidate), controller, events: [], started: false, done: false, error: null, cancelled: false, startedAt: Date.now() };
      const timer = setTimeout(() => controller.abort(), firstWordsWithinMs); // hard limit for the first words
      const onStop = () => controller.abort();
      if (stop) stop.addEventListener("abort", onStop);
      (async () => {
        try {
          const stream = backup
            ? streamBackup({ backup, key: process.env[backup.envKey], model, vision: candidate.vision, system: SYSTEM_PROMPT, contents, tools, signal: controller.signal })
            : streamChat({ key: process.env.GEMINI_API_KEY, model, system: SYSTEM_PROMPT, contents, tools, signal: controller.signal });
          for await (const event of stream) {
            if (!attempt.started && (event.text || event.call)) {
              attempt.started = true;
              clearTimeout(timer);
            }
            attempt.events.push(event);
            wake();
          }
        } catch (caught) {
          attempt.error = caught;
        } finally {
          attempt.done = true;
          clearTimeout(timer);
          if (stop) stop.removeEventListener("abort", onStop);
          wake();
        }
      })();
      return attempt;
    }

    /** Learns from a failed attempt (limits, broken keys, slow Gemini). */
    function noteFailure(attempt) {
      const { candidate, label } = attempt;
      const { provider, model, backup } = candidate;
      let error = attempt.error;
      if (!(error instanceof AiError)) {
        error = error && (error.name === "AbortError" || attempt.controller.signal.aborted)
          ? new AiError(`${label} was too slow.`, { status: 504, retryable: true })
          : new AiError(`${label} failed: ${(error && error.message) || "unknown error"}`, { retryable: true });
      }
      lastError = error;
      if (error.detail) console.log(`  ${label} said: ${error.detail}`);
      if (error.status === 429) {
        // Each model has its own free allowance.
        if (error.limit === "day") usedUpUntil.set(`${provider}:${model}`, Date.now() + 60 * 60 * 1000);
        else minuteWaits.push(error.retryAfter || 30);
        console.log(`  ${label}: free ${error.limit === "day" ? "daily" : "per-minute"} limit reached.`);
        return;
      }
      if (!backup && (error.status >= 500 || error.status === 400) && hasBackup()) {
        // Busy, too slow or refused: other Gemini models would be too. Backups first for a few minutes.
        skipGemini = true;
        if (error.status >= 500) geminiSlowUntil = Date.now() + GEMINI_COOLDOWN_MS;
      }
      if (backup && error.status === 404) backupModels.delete(backup.id); // pick another model next time
      if (backup && (error.status === 401 || error.status === 403)) {
        usedUpUntil.set(`${provider}:${model}`, Date.now() + 60 * 60 * 1000); // broken key: skip it for an hour
        broadcast({ type: "notice", message: `Your ${backup.name} key doesn't work. Paste it again in Settings.`, quiet: true });
      }
      console.log(`  ${label} answered ${error.status || "an error"}; trying the next one...`);
    }

    const cancelAll = (except) => {
      for (const a of running) {
        if (a !== except && !a.done) {
          a.cancelled = true;
          a.controller.abort();
        }
      }
    };

    let winner = null;
    let nextLaunchAt = 0;
    const noted = new Set();
    for (;;) {
      if (stop && stop.aborted) {
        cancelAll();
        throw new Stopped();
      }
      winner = running.find((a) => a.started);
      if (winner) break;
      for (const a of running) {
        if (a.done && !noted.has(a)) {
          noted.add(a);
          noteFailure(a);
        }
      }
      if (skipGemini) queue = queue.filter((c) => c.backup);
      const alive = running.filter((a) => !a.done).length;
      if (queue.length && (alive === 0 || (Date.now() >= nextLaunchAt && alive < MAX_PARALLEL))) {
        const candidate = queue.shift();
        if (running.length) console.log(`  No answer yet; also asking ${labelOf(candidate)}...`);
        running.push(launch(candidate));
        nextLaunchAt = Date.now() + hedgeMs;
        continue;
      }
      if (!queue.length && alive === 0) break; // everyone failed
      const waitMs = queue.length && alive < MAX_PARALLEL ? Math.max(0, nextLaunchAt - Date.now()) : 60000;
      await new Promise((resolve) => {
        pulse = resolve;
        setTimeout(resolve, waitMs);
      });
    }

    if (winner) {
      cancelAll(winner);
      const { candidate, label } = winner;
      answeringModel = label;
      // A backup beat a still-thinking Gemini: let the backups go first for a few minutes.
      if (candidate.backup && running.some((a) => !a.candidate.backup && a !== winner && !a.error)) {
        geminiSlowUntil = Date.now() + GEMINI_COOLDOWN_MS;
      }
      if (candidate.backup) broadcast({ type: "notice", message: `Using the backup AI (${candidate.backup.name}).`, quiet: true });
      let i = 0;
      for (;;) {
        while (i < winner.events.length) yield winner.events[i++];
        if (winner.done) break;
        await new Promise((resolve) => {
          pulse = resolve;
          setTimeout(resolve, 60000);
        });
      }
      if (stop && stop.aborted) throw new Stopped();
      if (winner.error) throw winner.error instanceof AiError ? winner.error : new AiError(`${label} stopped in the middle. Try again.`);
      if (!candidate.backup && models[0] !== candidate.model) models = [candidate.model, ...models.filter((m) => m !== candidate.model)];
      return;
    }

    // Only per-minute limits left: wait the time asked for (up to 45 s) and try once more.
    if (!waitedOnce && minuteWaits.length && lastError && lastError.limit !== "day") {
      const seconds = Math.min(Math.ceil(Math.min(...minuteWaits)) + 1, 45);
      broadcast({ type: "notice", message: `Free limit reached: waiting ${seconds} seconds, then I'll answer…`, quiet: true });
      console.log(`  Waiting ${seconds} s for the free per-minute limit...`);
      await wait(seconds * 1000);
      yield* streamTurn(contents, true, firstWordsWithinMs, { stop, hedgeMs });
      return;
    }
    if (lastError && lastError.status === 429 && lastError.limit === "day") {
      throw new AiError(
        hasBackup()
          ? "Today's free allowance is used up on Gemini and on your backup AIs. Gemini resets at midnight Pacific time. Adding another backup key in Settings helps."
          : "Today's free Gemini allowance is used up. It resets at midnight Pacific time. Adding free backup AI keys in Settings keeps me going.",
        { status: 429, limit: "day" },
      );
    }
    throw lastError || new AiError("No AI answered. Check your internet connection.");
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
    if (fig && DESIGN_REQUEST.test(text)) return "figma";
    if (fig && MEANS_FIGMA.test(text) && !MEANS_WEB.test(text)) return "figma";
    if (web && MEANS_WEB.test(text) && !MEANS_FIGMA.test(text)) return "browser";
    return parts.activeSurface();
  }

  // ---------- proposals and approval ----------
  let pending = null; // { id, summary, changes, lines, problems } waiting for the user's yes
  let currentRequest = ""; // what the user just said (a direct request is its own approval)
  let lastApplied = null; // { token, summary } so "undo" can put it back

  async function propose(args) {
    const changes = Array.isArray(args.changes) ? args.changes.slice(0, 20) : [];
    if (!changes.length) return { error: "No changes were given." };
    // Tidy the AI's wording: "Set_Fill" → "set_fill", "Semi Bold" → "semibold", etc.
    const tidy = (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : v);
    for (const c of changes) {
      c.action = tidy(c.action);
      if (c.side) c.side = tidy(c.side);
      for (const n of Array.isArray(c.nodes) ? c.nodes : []) {
        for (const k of ["type", "direction", "align", "cross_align", "text_align"]) if (n[k]) n[k] = tidy(n[k]);
        if (n.font_weight) n.font_weight = tidy(n.font_weight).replace(/_/g, "");
      }
    }
    const open = parts.figmaFile();
    const later = []; // screenshots for a Figma file that isn't open: added when it opens
    const now = [];
    for (const c of changes) {
      if (c.action === "place_screenshot") {
        // Attach the screenshot's details (the image itself is added only when approved).
        const entry = captures.get(c.capture_id || "latest");
        if (!entry) return { error: "There's no saved screenshot yet. Take one first (take_screenshot)." };
        c.capture_id = entry.id;
        c.capture = { name: entry.name, css_width: entry.cssWidth, css_height: entry.cssHeight };
        if (c.figma_file && !(open && captures.sameFile(c.figma_file, open.name))) {
          later.push(c);
          continue;
        }
        delete c.figma_file;
      }
      now.push(c);
    }
    if (now.length && !parts.connected("figma")) {
      return { error: "Figma isn't connected, so nothing can be changed now. Ask the user to run the Design Agent plugin in Figma." };
    }

    let preview = { lines: [], problems: [], valid: [] };
    if (now.length) {
      try {
        preview = await parts.call("figma", "figma.preview", { changes: now }, 15000);
      } catch (error) {
        return { error: `Couldn't check the changes in Figma: ${error.message}` };
      }
    }
    const laterLines = later.map((c) => `Add "${c.capture.name}" to the Figma file "${c.figma_file}" — it appears as soon as you open that file`);
    const lines = preview.lines.concat(laterLines);
    if (!lines.length) return { error: "None of these changes can be made: " + preview.problems.join("; ") };

    if (pending) broadcast({ type: "approval_update", id: pending.id, state: "replaced" });
    // You asked for it, so it's done (say "undo" to put it back). Only with "Ask me before
    // changing" turned on in Settings does it wait for your yes.
    const direct = process.env.ASK_BEFORE_CHANGES !== "on";
    // Only the changes that passed the check will be applied.
    const doable = now.filter((c, i) => !preview.valid || preview.valid[i]).concat(later);
    pending = { id: randomUUID(), summary: String(args.summary || "Change the design"), changes: doable, lines, problems: preview.problems };
    broadcast({ type: "approval", id: pending.id, summary: pending.summary, lines: pending.lines, problems: pending.problems, direct });

    // The user asked for this themselves ("make the title bigger"): their request is the
    // approval, so do it now. They can still say "undo".
    if (direct) {
      const proposal = pending;
      pending = null;
      console.log(`  Doing it (asked directly): ${proposal.summary}`);
      try {
        const { result, failed, laterFile } = await applyProposal(proposal, proposal.id);
        if (!result) return { status: "will_be_added_later", file: laterFile, note: `Tell them in one short sentence it'll appear when they open "${laterFile}".` };
        return {
          status: "done",
          changed: proposal.lines,
          failed: failed.map((f) => `${f.change} ${f.id}: ${f.error}`),
          layers_now: result.after,
          note: "It's done. Confirm in one short sentence (point at it). Don't ask for permission; they can say undo.",
        };
      } catch (error) {
        return { error: `Couldn't make the change in Figma: ${error.message}` };
      }
    }
    console.log(`  Waiting for approval: ${pending.summary}`);
    return {
      status: "waiting_for_user_approval",
      will_change: pending.lines,
      cannot_change: pending.problems,
      note: "Nothing has changed yet. Ask the user, in one short sentence, if you should apply it.",
    };
  }

  // ---------- screenshots waiting for a Figma file ----------
  let delivering = false;

  /** Called when a Figma file opens: adds any screenshots the user asked to put in it. */
  async function figmaFileOpened(fileName) {
    const waiting = captures.deliveriesFor(fileName);
    if (!waiting.length || delivering) return;
    delivering = true;
    try {
      await wait(1500); // let the plugin settle after opening the file
      if (!(await waitUntilFree())) return;
      busy = true;
      const placed = [];
      for (const d of waiting) {
        const entry = captures.get(d.change.capture_id);
        if (!entry) {
          captures.removeDelivery(d.id);
          continue;
        }
        const change = { ...d.change, near_id: undefined, images: captures.load(entry) };
        delete change.figma_file;
        try {
          const result = await parts.call("figma", "figma.apply", { changes: [change] }, 60000);
          const r = result.results[0];
          if (r && r.ok) {
            captures.markPlaced(entry.id, r.created, result.file, r.page);
            captures.removeDelivery(d.id);
            placed.push({ name: entry.name, id: r.created });
            lastApplied = { token: result.token, summary: `Add ${entry.name}` };
          }
        } catch (error) {
          console.log(`  Couldn't add the waiting screenshot yet: ${error.message}`);
        }
      }
      busy = false;
      if (placed.length) {
        console.log(`  Added ${placed.length} waiting screenshot(s) to "${fileName}"`);
        const what = placed.length === 1 ? `the screenshot "${placed[0].name}"` : `${placed.length} screenshots`;
        sayDirect(null, `I've added ${what} to this file, like you asked. [[${placed[0].id}]] Here it is.`);
      }
    } finally {
      busy = false;
      delivering = false;
    }
  }

  // The review marks on screen now, so "fix number 2" knows what number 2 is.
  let lastMarks = [];

  async function markIssues(marks) {
    marks = (Array.isArray(marks) ? marks : []).slice(0, 12).map((m) => ({
      id: String(m.id || "").trim(),
      kind: ["ux", "ui", "content"].includes(String(m.kind || "").toLowerCase()) ? String(m.kind).toLowerCase() : "ux",
      note: String(m.note || "").slice(0, 80),
    }));
    const web = marks.filter((m) => /^w\d/.test(m.id));
    const fig = marks.filter((m) => !/^w\d/.test(m.id));
    const result = { marked: 0, missing: [] };
    // Numbers stay in the order given, even when marks are split between Chrome and Figma.
    const keepNumbers = (list) => marks.map((m) => (list.includes(m) ? m : { id: "-", kind: m.kind, note: "" }));
    try {
      if (web.length && parts.connected("browser")) {
        const r = await parts.call("browser", "page.call", { file: "marks.js", method: "mark", args: [keepNumbers(web)] }, 8000);
        result.marked += (r && r.marked) || 0;
      }
      if (fig.length && parts.connected("figma")) {
        const r = await parts.call("figma", "figma.mark", { marks: keepNumbers(fig) }, 10000);
        result.marked += (r && r.marked) || 0;
      }
    } catch (error) {
      return { error: `Couldn't draw the marks: ${error.message}` };
    }
    lastMarks = marks;
    console.log(`  Marked ${result.marked} finding${result.marked === 1 ? "" : "s"} on screen.`);
    return {
      marked: result.marked,
      numbers: marks.map((m, i) => `${i + 1} = ${m.id} (${m.kind.toUpperCase()}: ${m.note})`),
      note: "Now say them in this order, briefly, pointing at each. If they ask to fix one or all, change it in Figma right away.",
    };
  }

  function clearMarks() {
    lastMarks = [];
    if (parts.connected("browser")) parts.call("browser", "page.call", { file: "marks.js", method: "clearMarks", args: [] }, 5000).catch(() => {});
    if (parts.connected("figma")) parts.call("figma", "figma.clear_marks", {}, 5000).catch(() => {});
    return { cleared: true };
  }

  async function runTool(call) {
    if (call.name === "mark_issues") return { response: await markIssues((call.args || {}).marks), extra: [] };
    if (call.name === "clear_marks") return { response: clearMarks(), extra: [] };
    if (call.name === "look_at_webpage" || call.name === "look_at_figma") {
      const [description, ...images] = call.name === "look_at_figma" ? await lookAtFigma() : await lookAtWebpage();
      return { response: { result: description.text }, extra: images };
    }
    if (call.name === "propose_figma_changes") return { response: await propose(call.args || {}), extra: [] };
    if (call.name === "propose_design") {
      const args = call.args || {};
      broadcast({ type: "notice", message: "Designing it…", quiet: true });
      const design = { action: "create_design", ...args, style: args.style === "styled" ? "styled" : "wireframe" };
      delete design.summary;
      const summary = args.summary || `Create ${design.style === "styled" ? "a design" : "a wireframe"}: ${args.name || "new screen"}`;
      return { response: await propose({ summary, changes: [design] }), extra: [] };
    }
    if (call.name === "search_web") {
      const { query = "", count = 8 } = call.args || {};
      broadcast({ type: "notice", message: `Searching: ${query}`, quiet: true });
      try {
        const gemini = process.env.GEMINI_API_KEY && models && models.length ? { key: process.env.GEMINI_API_KEY, model: models[0] } : null;
        const found = await searchWeb(String(query), count, gemini);
        console.log(`  Searched "${query}" (${found.results.length} results via ${found.via})`);
        return { response: found, extra: [] };
      } catch (error) {
        return { response: { error: `Couldn't search: ${error.message}` }, extra: [] };
      }
    }
    if (call.name === "screenshot_tabs") return { response: startTabScreenshots(call.args || {}), extra: [] };
    if (call.name === "open_websites") {
      const urls = (call.args || {}).urls || [];
      if (parts.connected("browser")) {
        // Through the Chrome add-on, so we know which tabs these are (for "screenshot them all").
        try {
          const { opened } = await parts.call("browser", "web.open_tabs", { urls }, 15000);
          openedTabs = opened;
          console.log(`  Opened ${opened.length} site(s) in Chrome`);
          broadcast({ type: "notice", message: `Opened ${opened.length} site${opened.length > 1 ? "s" : ""} in Chrome`, quiet: true });
          return { response: { opened: opened.map((o) => o.url) }, extra: [] };
        } catch (error) {
          console.log(`  Opening through the add-on failed (${error.message}); opening Chrome directly.`);
        }
      }
      try {
        const opened = openInChrome(urls);
        console.log(`  Opened ${opened.length} site(s) in Chrome`);
        broadcast({ type: "notice", message: `Opened ${opened.length} site${opened.length > 1 ? "s" : ""} in Chrome`, quiet: true });
        return { response: { opened }, extra: [] };
      } catch (error) {
        return { response: { error: error.message }, extra: [] };
      }
    }
    if (call.name === "take_screenshot") return { response: await takeScreenshot(Boolean((call.args || {}).full_page)), extra: [] };
    if (call.name === "list_screenshots") {
      const open = parts.figmaFile();
      const waiting = captures.waitingDeliveries();
      const list = captures.list().slice(0, 20).map((c) => ({
        id: c.id, name: c.name, web_page: c.url, taken: c.createdAt,
        in_figma: c.placedInFigma.map((p) => ({
          layer_id: p.nodeId, file: p.file, page: p.page,
          file_is_open_now: Boolean(open && captures.sameFile(open.name, p.file)),
        })),
        waiting_for_file: waiting.filter((d) => d.change.capture_id === c.id).map((d) => d.file),
      }));
      return { response: { screenshots: list, total: captures.list().length, figma_file_open_now: open ? open.name : null }, extra: [] };
    }
    if (call.name === "find_in_figma") {
      try {
        return { response: await parts.call("figma", "figma.find", { query: (call.args || {}).query || "" }, 30000), extra: [] };
      } catch (error) {
        return { response: { error: error.message }, extra: [] };
      }
    }
    if (call.name === "go_to_figma_layer") {
      try {
        return { response: await parts.call("figma", "figma.goto", { id: String((call.args || {}).id || "") }, 15000), extra: [] };
      } catch (error) {
        return { response: { error: error.message }, extra: [] };
      }
    }
    if (call.name === "open_figma_file") {
      const name = String((call.args || {}).file || "");
      const file = captures.findFile(name);
      if (!file) return { response: { error: `I haven't seen a Figma file called "${name}" yet.` }, extra: [] };
      if (!file.key) return { response: { error: `Figma doesn't share "${file.name}"'s link with the plugin, so the user needs to open it themselves (in Figma: recent files).` }, extra: [] };
      broadcast({ type: "open_url", url: `https://www.figma.com/design/${file.key}` });
      return { response: { opening: file.name, note: "Once it's open and the plugin is running, you can take them to the layer." }, extra: [] };
    }
    return { response: { error: `Unknown tool ${call.name}` }, extra: [] };
  }

  async function takeScreenshot(fullPage) {
    if (!parts.connected("browser")) return { error: "The Chrome add-on isn't connected." };
    broadcast({ type: "capturing", fullPage });
    try {
      const shot = await parts.call("browser", "web.screenshot", { fullPage }, 90000);
      const entry = captures.add(shot);
      broadcast({ type: "captured", id: entry.id, name: entry.name, thumb: `/captures/${entry.files[0].file}` });
      console.log(`  Saved ${entry.name} (${entry.cssWidth}x${entry.cssHeight}, ${entry.files.length} part${entry.files.length > 1 ? "s" : ""})`);
      return { saved: true, capture_id: entry.id, name: entry.name, size: `${entry.cssWidth}x${entry.cssHeight}`, page: entry.url };
    } catch (error) {
      return { error: `Couldn't take the screenshot: ${error.message}` };
    }
  }

  // ---------- screenshots of many tabs, put into Figma (runs in the background) ----------
  let openedTabs = []; // [{ tabId, url }] the sites opened with open_websites
  let tabJob = null;

  function startTabScreenshots({ which = "opened", full_page = true, put_in_figma = true, figma_file = "" }) {
    if (!parts.connected("browser")) return { error: "The Chrome add-on isn't connected." };
    if (tabJob) return { error: "I'm still taking the last batch of screenshots. I'll say when it's done." };
    tabJob = runTabScreenshots({ which: which === "all" ? "all" : "opened", fullPage: full_page !== false, toFigma: put_in_figma !== false, figmaFile: String(figma_file || "") })
      .catch((error) => announce(`The screenshots stopped: ${error.message}`))
      .finally(() => {
        tabJob = null;
      });
    return { started: true, note: "Running in the background (about 5 to 15 seconds per page). Tell the user briefly that you're on it; you'll be told when it's done." };
  }

  /** Tells the user something when a background job finishes (spoken, also on a call). */
  function announce(message) {
    console.log(`  ${message}`);
    broadcast({ type: "announce", message });
    history.push({ role: "user", parts: [{ text: "(Design Agent note)" }] }, { role: "model", parts: [{ text: message }] });
    history = history.slice(-MAX_HISTORY);
  }

  async function runTabScreenshots({ which, fullPage, toFigma, figmaFile }) {
    let tabs = which === "opened" ? openedTabs : [];
    if (!tabs.length) tabs = (await parts.call("browser", "web.list_tabs", {}, 10000)).tabs;
    if (!tabs.length) return announce("There are no website tabs open in Chrome to screenshot.");
    const entries = [];
    const failed = [];
    for (let i = 0; i < tabs.length; i++) {
      const site = (() => {
        try {
          return new URL(tabs[i].url).hostname.replace(/^www\./, "");
        } catch {
          return tabs[i].url;
        }
      })();
      broadcast({ type: "notice", message: `Screenshot ${i + 1} of ${tabs.length}: ${site}…`, quiet: true });
      try {
        const shot = await parts.call("browser", "web.screenshot", { fullPage, tabId: tabs[i].tabId }, 120000);
        const entry = captures.add(shot);
        entries.push(entry);
        broadcast({ type: "captured", id: entry.id, name: entry.name, thumb: `/captures/${entry.files[0].file}` });
        console.log(`  Saved ${entry.name} (${entry.cssWidth}x${entry.cssHeight})`);
      } catch (error) {
        failed.push(site);
        console.log(`  Couldn't screenshot ${site}: ${error.message}`);
      }
    }
    const missed = failed.length ? ` I couldn't capture ${failed.join(", ")}.` : "";
    if (!entries.length) return announce(`I couldn't take any of the screenshots.${missed}`);
    if (!toFigma) return announce(`Done: ${entries.length} screenshot${entries.length > 1 ? "s" : ""} saved.${missed}`);

    const open = parts.figmaFile();
    const change = (entry, extra) => ({
      action: "place_screenshot",
      capture_id: entry.id,
      capture: { name: entry.name, css_width: entry.cssWidth, css_height: entry.cssHeight },
      ...extra,
    });
    if (figmaFile && !(open && captures.sameFile(figmaFile, open.name))) {
      for (const entry of entries) captures.addDelivery(change(entry, {}), figmaFile);
      return announce(`Done: ${entries.length} screenshots are ready. They'll appear in "${figmaFile}" as soon as you open it in Figma.${missed}`);
    }
    if (!parts.connected("figma") && parts.ensureFigma) await parts.ensureFigma();
    if (!parts.connected("figma")) return announce(`Done: ${entries.length} screenshots saved, but Figma isn't connected, so they're not in Figma yet. Run the plugin and say "put them in Figma".${missed}`);

    // One by one (the images are big), each to the right of the previous one.
    let previous = null;
    let placed = 0;
    for (const entry of entries) {
      broadcast({ type: "notice", message: `Putting ${placed + 1} of ${entries.length} into Figma…`, quiet: true });
      const c = change(entry, previous ? { near_id: previous, side: "right", gap: 120 } : {});
      try {
        const result = await parts.call("figma", "figma.apply", { changes: [{ ...c, images: captures.load(entry) }] }, 60000);
        const r = result.results[0];
        if (r && r.ok && r.created) {
          captures.markPlaced(entry.id, r.created, result.file || "", r.page);
          previous = r.created;
          placed++;
          lastApplied = { token: result.token, summary: `Add ${entry.name}` };
        }
      } catch (error) {
        console.log(`  Couldn't put ${entry.name} into Figma: ${error.message}`);
      }
    }
    return announce(`Done: ${placed} full${fullPage ? "-page" : ""} screenshot${placed === 1 ? "" : "s"} are in Figma, side by side.${missed}`);
  }

  /** Says something without asking the AI (used for approvals, "no" and "undo"). */
  function sayDirect(userText, reply) {
    if (userText) broadcast({ type: "message", role: "user", text: userText });
    broadcast({ type: "agent_start" });
    broadcast({ type: "agent_delta", text: reply });
    broadcast({ type: "agent_done", text: reply });
    history.push({ role: "user", parts: [{ text: userText || "(clicked)" }] }, { role: "model", parts: [{ text: reply }] });
    history = history.slice(-MAX_HISTORY);
  }

  async function waitUntilFree() {
    for (let i = 0; busy && i < 150; i++) await wait(100);
    return !busy;
  }

  /** ACT, then VERIFY. Only reachable from the user's own click or clear "yes". */
  /**
   * ACT: carries out a proposal in Figma. Screenshots for a file that isn't open are
   * remembered instead. Returns { result, failed, laterFile } (result is null if nothing ran now).
   */
  async function applyProposal(proposal, id) {
    const later = proposal.changes.filter((c) => c.figma_file);
    for (const c of later) captures.addDelivery(c, c.figma_file);
    const now = proposal.changes.filter((c) => !c.figma_file);
    const laterFile = later.length ? later[0].figma_file : null;
    if (!now.length) {
      broadcast({ type: "approval_update", id, state: "applied", failed: 0 });
      return { result: null, failed: [], laterFile };
    }
    broadcast({ type: "approval_update", id, state: "applying" });
    // Add the screenshot images now that it's going ahead.
    const changes = now.map((c) => {
      if (c.action !== "place_screenshot") return c;
      const entry = captures.get(c.capture_id);
      return entry ? { ...c, images: captures.load(entry) } : c;
    });
    let result;
    try {
      result = await parts.call("figma", "figma.apply", { changes }, 60000);
    } catch (error) {
      broadcast({ type: "approval_update", id, state: "failed" });
      throw error;
    }
    const failed = result.results.filter((r) => !r.ok);
    for (const r of result.results) if (r.ok && r.capture_id && r.created) captures.markPlaced(r.capture_id, r.created, result.file || "", r.page);
    lastApplied = { token: result.token, summary: proposal.summary };
    broadcast({ type: "approval_update", id, state: "applied", failed: failed.length });
    console.log(`  Applied: ${proposal.summary}${failed.length ? ` (${failed.length} failed)` : ""}`);
    return { result, failed, laterFile };
  }

  /** ACT, then VERIFY. Only reachable from the user's own click or clear "yes". */
  async function approve(id, userText = null) {
    if (!pending || pending.id !== id) {
      broadcast({ type: "approval_update", id, state: "expired" });
      return;
    }
    if (!(await waitUntilFree())) return;
    const proposal = pending;
    pending = null;

    busy = true;
    let outcome;
    try {
      outcome = await applyProposal(proposal, id);
    } catch (error) {
      busy = false;
      sayDirect(userText, `Sorry, I couldn't make the change in Figma: ${error.message}.`);
      return;
    }
    busy = false;
    if (!outcome.result) {
      sayDirect(userText, `Okay. I'll add it to "${outcome.laterFile}" the moment you open that file in Figma.`);
      return;
    }
    const { result } = outcome;

    // VERIFY: let the AI look at the result and report back briefly.
    const report =
      `[The user approved "${proposal.summary}", and it has now been applied in Figma.]\n` +
      `Results: ${result.results.map((r) => `${r.change} ${r.id}: ${r.ok ? "done" : "FAILED (" + r.error + ")"}`).join("; ")}\n` +
      `The changed layers now:\n${result.after}\n` +
      "In one short sentence, confirm what changed (point at it). " +
      "If something failed, say what and why. Don't propose another change unless they ask.";
    const extra = result.screenshot ? [{ inlineData: { mimeType: "image/jpeg", data: result.screenshot } }] : [];
    await runTurn({ userText: userText, promptText: report, extraParts: extra, historyText: `${userText || "(clicked Apply)"} [approved: ${proposal.summary}]`, observe: false });
  }

  async function reject(id, userText = null) {
    if (!pending || pending.id !== id) return;
    if (!(await waitUntilFree())) return;
    broadcast({ type: "approval_update", id, state: "rejected" });
    console.log(`  Not applied: ${pending.summary}`);
    pending = null;
    sayDirect(userText, "Okay, I'll leave it as it is.");
  }

  async function undoLast(userText = null) {
    if (!lastApplied) {
      if (userText) sayDirect(userText, "There's nothing of mine to undo. In Figma you can always press Ctrl Z.");
      return;
    }
    if (!(await waitUntilFree())) return;
    const applied = lastApplied;
    lastApplied = null;
    try {
      const result = await parts.call("figma", "figma.undo", { token: applied.token }, 20000);
      broadcast({ type: "approval_update", state: "undone" });
      const note = result.notes && result.notes.length ? ` One thing I couldn't reverse: ${result.notes[0]}.` : "";
      sayDirect(userText, `Done, I put it back the way it was.${note}`);
    } catch (error) {
      sayDirect(userText, `I couldn't undo that: ${error.message}. Ctrl Z in Figma will do it.`);
    }
  }

  // ---------- one turn of conversation ----------

  async function handleUserText(text) {
    text = String(text || "").trim();
    if (!text) return;
    if (!process.env.GEMINI_API_KEY && !hasBackup()) {
      broadcast({ type: "error", message: "Add your free Gemini key first (Settings → Change AI key)." });
      return;
    }

    // Short answers to a waiting proposal are decided here, by code, not by the AI.
    const answer = classifyReply(text);
    if (pending && answer === "yes") return approve(pending.id, text);
    if (pending && answer === "no") return reject(pending.id, text);
    if (answer === "undo" && lastApplied && !pending) return undoLast(text);

    if (busy && turnStop) {
      // You talked over the answer: stop it and answer the new words instead.
      turnStop.abort();
      if (!(await waitUntilFree())) return;
    }
    if (busy) {
      broadcast({ type: "error", message: "One moment, I'm still answering." });
      return;
    }
    // Asking about Figma while the plugin isn't running: start it first (Windows).
    if (!parts.connected("figma") && (MEANS_FIGMA.test(text) || DESIGN_REQUEST.test(text)) && parts.ensureFigma) {
      broadcast({ type: "notice", message: "Starting the Design Agent plugin in Figma…", quiet: true });
      await parts.ensureFigma();
    }
    const note = pending
      ? `\n[A proposed change is still waiting for the user's approval: "${pending.summary}". If they now want something different, propose the new version (it replaces the waiting one). Only the user can approve it.]`
      : "";
    await runTurn({ userText: text, promptText: text + note, historyText: text, observe: true });
  }

  /**
   * One AI turn: OBSERVE (optional) → stream the answer, running any tools it asks for.
   * userText: shown as your message (null = none). promptText: what the AI gets.
   */
  async function runTurn({ userText, promptText, extraParts = [], historyText, observe }) {
    busy = true;
    const stopper = (turnStop = new AbortController());
    currentRequest = userText || "";
    if (userText) broadcast({ type: "message", role: "user", text: userText });
    broadcast({ type: "agent_start" });

    let reply = "";
    const startedAt = Date.now();
    try {
      // OBSERVE: if the question is about the screen, look first.
      const userParts = [{ text: promptText }, ...extraParts];
      if (lastMarks.length) {
        userParts.push({ text: `[Review marks on the user's screen now: ${lastMarks.map((m, i) => `${i + 1} = ${m.id} (${m.kind.toUpperCase()}: ${m.note})`).join("; ")}]` });
      }
      // Just "take a screenshot" doesn't need a look first (it's quicker without).
      const onlyCapture = /\b(take|grab|capture|get|make)\b[^.?]*\bscreen ?shot\b/i.test(promptText) && !/\?/.test(promptText);
      const surface = observe && !onlyCapture && ABOUT_SCREEN.test(promptText) ? surfaceFor(promptText) : null;
      if (surface) {
        const [description, ...images] = surface === "figma" ? await lookAtFigma() : await lookAtWebpage();
        const where = surface === "figma" ? "their Figma design" : "the web page in Chrome";
        userParts.push({ text: `[What the user is looking at right now: ${where}]\n` + description.text }, ...images);
      }
      const contents = [...history, { role: "user", parts: userParts }];
      // Designs are big plans that arrive all at once, so give them longer before switching.
      const designing = DESIGN_REQUEST.test(promptText) || /\b(create|design|wireframe)\b/i.test(promptText);
      const patience = designing ? 25000 : 8000;

      // UNDERSTAND / DISCUSS / SUGGEST: stream the answer; run any tools it asks for.
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const modelParts = [];
        const calls = [];
        for await (const event of streamTurn(contents, false, patience, { stop: stopper.signal, hedgeMs: designing ? 8000 : HEDGE_MS })) {
          modelParts.push(event.part);
          if (event.call) calls.push(event.call);
          if (event.text) {
            if (!reply) console.log(`  First words after ${((Date.now() - startedAt) / 1000).toFixed(1)} s (${answeringModel})`);
            reply += event.text;
            broadcast({ type: "agent_delta", text: event.text });
          }
        }
        if (!calls.length || round === MAX_TOOL_ROUNDS || stopper.signal.aborted) break;

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

      if (stopper.signal.aborted) throw new Stopped();
      if (!reply.trim()) {
        reply = pending ? "Want me to apply that?" : "Sorry, I didn't get an answer back. Could you say that again?";
        broadcast({ type: "agent_delta", text: reply });
      }
      // Keep only the words in the history; screenshots are large and get old quickly.
      const proposalNote = pending ? ` [proposed, waiting for approval: ${pending.summary}]` : "";
      history.push({ role: "user", parts: [{ text: historyText }] }, { role: "model", parts: [{ text: reply + proposalNote }] });
    } catch (error) {
      if (error instanceof Stopped || stopper.signal.aborted) {
        // Interrupted: keep what was already said, so the conversation still makes sense.
        if (reply.trim()) history.push({ role: "user", parts: [{ text: historyText }] }, { role: "model", parts: [{ text: reply + " …(interrupted)" }] });
        console.log("  Stopped: you started talking.");
        return;
      }
      const message = error instanceof AiError ? error.message : "Something went wrong while answering. Try again.";
      if (!(error instanceof AiError)) console.error(error);
      broadcast({ type: "error", message });
    } finally {
      history = history.slice(-MAX_HISTORY);
      broadcast({ type: "agent_done", text: reply, stopped: stopper.signal.aborted });
      if (turnStop === stopper) turnStop = null;
      busy = false;
    }
  }

  return {
    handleUserText,
    // ---- used by the live phone-call voice (live-call.js) ----
    /** All tools (a call lasts a while, so Chrome/Figma may connect later; unavailable ones say so). */
    liveTools: () => toolsNow({ all: true }),
    async runToolForLive(call) {
      if (["look_at_webpage", "take_screenshot"].includes(call.name) && !parts.connected("browser")) {
        return { error: "The Chrome add-on isn't connected. Ask the user to open Chrome (with the Design Agent add-on on)." };
      }
      if (["look_at_figma", "find_in_figma", "go_to_figma_layer", "propose_design"].includes(call.name) && !parts.connected("figma")) {
        if (parts.ensureFigma) await parts.ensureFigma();
        if (!parts.connected("figma")) return { error: "The Figma plugin isn't running. Ask the user to open their Figma file." };
      }
      const { response } = await runTool(call);
      return response;
    },
    /** What the user just said on the call (a direct request is its own approval). */
    setRequest(text) {
      currentRequest = String(text || "");
    },
    /** Keeps the call in the same conversation history as typed chat. */
    remember(userText, reply) {
      if (!userText && !reply) return;
      history.push({ role: "user", parts: [{ text: userText || "(no words)" }] }, { role: "model", parts: [{ text: reply || "" }] });
      history = history.slice(-MAX_HISTORY);
    },
    /** The last part of the conversation as plain text (to continue it on a call). */
    recentConversation(maxTurns = 12) {
      return history
        .slice(-maxTurns)
        .map((m) => `${m.role === "model" ? "You" : "User"}: ${m.parts.map((p) => p.text || "").join("")}`)
        .join("\n");
    },
    hasPending: () => Boolean(pending),
    approve: (id) => approve(id),
    figmaFileOpened: (name) => figmaFileOpened(name),
    reject: (id) => reject(id),
    undoLast: () => undoLast(),
    /** Sent to a helper window when it opens, so a waiting card shows up there too. */
    pendingApproval: () => (pending ? { id: pending.id, summary: pending.summary, lines: pending.lines, problems: pending.problems } : null),
    /** Look up the available models in the background, so the first answer is quick. */
    warmUp() {
      if (process.env.GEMINI_API_KEY) ensureModels().catch(() => {});
    },
    reset() {
      history = [];
      pending = null;
      broadcast({ type: "history", messages: [] });
    },
    history: () =>
      history.map((m) => ({
        role: m.role === "model" ? "agent" : "user",
        text: m.parts.map((p) => p.text || "").join(""),
      })),
    status: () => ({
      hasKey: Boolean(process.env.GEMINI_API_KEY || hasBackup()),
      model: models?.[0] || null,
      backups: Object.fromEntries(BACKUPS.map((b) => [b.id, process.env[b.envKey] ? (backupModels.get(b.id) || {}).model || "ready" : null])),
      busy,
    }),
    forgetModel() {
      models = null;
      backupModels.clear();
    },
  };
}
