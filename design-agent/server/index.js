// The local server: the "brain" of Design Agent.
// It serves the helper window, and every part (helper window, Chrome add-on,
// Figma plugin) connects to it over a WebSocket at ws://localhost:PORT/ws.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { loadEnv, saveEnvValue } from "./env.js";
import { createAgent } from "./agent/agent.js";
import { AiError, listChatModels, pickModel } from "./ai/gemini.js";
import { BACKUPS, backupById, pickBackupModel } from "./ai/backups.js";
import { openWindow } from "./open-window.js";
import { createCaptures } from "./captures.js";
import { createFigmaAutostart } from "./figma-autostart.js";
import { createLiveCalls } from "./agent/live-call.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env");
const CONSOLE_DIR = path.join(ROOT, "console");
const EXTENSION_DIR = path.join(ROOT, "extension");

loadEnv(ENV_FILE);
const PORT = Number(process.env.PORT) || 3456;
const URL_BASE = `http://localhost:${PORT}`;
const shouldOpen = process.argv.includes("--open");

// ---------- connected parts ----------
/** role -> Set of sockets. Roles: "console" now; "browser" and "figma" in later steps. */
const clients = { console: new Set(), browser: new Set(), figma: new Set() };

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
function broadcast(message, role = "console") {
  for (const socket of clients[role]) send(socket, message);
}
function connections() {
  return {
    browser: clients.browser.size > 0,
    figma: clients.figma.size > 0,
    browserNeedsReload: clients.browser.size > 0 && extensionNeedsReload,
  };
}
const AVATAR_FILE = path.join(ROOT, "data", "avatar");
function settings() {
  return {
    autoStartFigma: process.env.AUTO_START_FIGMA !== "off",
    autoStartSupported: process.platform === "win32",
    askBeforeChanges: process.env.ASK_BEFORE_CHANGES === "on",
    hasAvatar: existsSync(AVATAR_FILE),
  };
}
function broadcastStatus() {
  broadcast({ type: "status", ...agent.status(), connections: connections(), settings: settings() });
}

// ---------- asking the Chrome add-on / Figma plugin to do something ----------
const pendingCalls = new Map(); // id -> { resolve, reject, timer }

function newestClient(role) {
  return [...clients[role]].pop();
}

// When you last did something in Chrome or in Figma, so "this" means the right one.
const lastActivity = { browser: 0, figma: 0 };
let figmaFile = { name: "", key: "", page: "" }; // the file open in Figma right now

const parts = {
  connected: (role) => clients[role].size > 0,
  /** The Figma file that's open (name, key, page), or null when Figma isn't connected. */
  figmaFile: () => (clients.figma.size > 0 && figmaFile.name ? { ...figmaFile } : null),
  /** "browser" or "figma": the connected one you used most recently (or null). */
  activeSurface() {
    const connected = ["browser", "figma"].filter((role) => clients[role].size > 0);
    if (connected.length < 2) return connected[0] || null;
    return lastActivity.figma > lastActivity.browser ? "figma" : "browser";
  },
  /** Sends a request to a part (e.g. the Chrome add-on) and waits for its answer. */
  call(role, tool, args = {}, timeoutMs = 10000) {
    const socket = newestClient(role);
    if (!socket) return Promise.reject(new Error(`the ${role === "browser" ? "Chrome add-on" : role} isn't connected`));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCalls.delete(id);
        reject(new Error("it took too long to answer"));
      }, timeoutMs);
      pendingCalls.set(id, { resolve, reject, timer });
      send(socket, { type: "request", id, tool, args });
    });
  },
};

function finishCall(message) {
  const call = pendingCalls.get(message.id);
  if (!call) return;
  pendingCalls.delete(message.id);
  clearTimeout(call.timer);
  if (message.ok) call.resolve(message.data);
  else call.reject(new Error(message.error || "it failed"));
}

// ---------- the pointer ----------
// Web page elements have ids like "w12"; Figma layers have ids like "12:34".
function pointAt(target) {
  const log = (result) => result && result.ok === false && console.log(`  Pointer: ${result.reason}`);
  if (/^w\d/.test(target)) {
    if (!parts.connected("browser")) return;
    parts.call("browser", "page.call", { file: "pointer.js", method: "show", args: [target] }, 5000).then(log).catch(() => {});
  } else if (parts.connected("figma")) {
    parts.call("figma", "figma.point", { target }, 5000).then(log).catch(() => {});
  }
}

function clearPointers() {
  if (parts.connected("browser")) parts.call("browser", "page.call", { file: "pointer.js", method: "hide", args: [] }, 5000).catch(() => {});
  if (parts.connected("figma")) parts.call("figma", "figma.hide", {}, 5000).catch(() => {});
}

/** The add-on core version on disk. If the running add-on is older, it must be reloaded once. */
function expectedExtensionCore() {
  try {
    const source = readFileSync(path.join(EXTENSION_DIR, "background.js"), "utf8");
    return Number((source.match(/CORE_VERSION\s*=\s*(\d+)/) || [])[1] || 0);
  } catch {
    return 0;
  }
}
let extensionNeedsReload = false;

// ---------- starting the Figma plugin automatically (Windows) ----------
const autostart = createFigmaAutostart({
  isConnected: () => clients.figma.size > 0,
  enabled: () => process.env.AUTO_START_FIGMA !== "off",
  onNeedsHelp: () =>
    broadcast({
      type: "notice",
      message:
        "I couldn't start the Figma plugin by myself (maybe another plugin was used last). In Figma, run Plugins → Development → Design Agent once; after that I can start it for you.",
    }),
  // The app you're using (not the helper window) tells us what "this" means.
  onFront: (app) => {
    if (/^figma$/i.test(app)) lastActivity.figma = Date.now();
    else if (/^chrome$/i.test(app)) lastActivity.browser = Date.now();
  },
});
parts.ensureFigma = () => autostart.ensure();

const captures = createCaptures(ROOT);
const agent = createAgent({ broadcast, parts, captures });
const liveCallFor = createLiveCalls({ agent, pointAt });

// ---------- web server ----------
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };

async function readJson(req, limit = 1e6) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error("too large");
  }
  return JSON.parse(body || "{}");
}

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

// Requests that change something must carry this header. Browsers don't let
// other websites add custom headers to requests to us, so they can't use these.
const fromOurApp = (req) => req.headers["x-design-agent"] === "1";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, URL_BASE);

  if (url.pathname === "/api/backups") {
    return json(res, 200, BACKUPS.map((b) => ({ id: b.id, name: b.name, keysUrl: b.keysUrl })));
  }

  if (url.pathname === "/api/status") {
    return json(res, 200, { ...agent.status(), connections: connections() });
  }

  if (req.method === "POST" && !fromOurApp(req)) {
    return json(res, 403, { ok: false, error: "Not allowed." });
  }

  // A newer start of Design Agent asks the running one to make room for it.
  if (url.pathname === "/api/quit" && req.method === "POST") {
    json(res, 200, { ok: true });
    console.log("\n  Design Agent was started again in another window, so this one is closing.\n");
    for (const socket of wss.clients) socket.terminate();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
    return;
  }

  if (url.pathname === "/api/key" && req.method === "POST") {
    try {
      const { key, provider } = await readJson(req);
      const backup = provider ? backupById(provider) : null;
      if (provider && !backup) return json(res, 400, { ok: false, error: "Unknown AI service." });
      // Remove spaces, line breaks and quotes that often come along when copying.
      const clean = String(key || "").replace(/[\s"'`]/g, "");
      if (clean.length < 20) {
        return json(res, 400, {
          ok: false,
          error: clean
            ? `That's too short to be a key (${clean.length} characters). Use the Copy button next to your key on ${backup ? backup.keysUrl : "aistudio.google.com/apikey"}.`
            : "Paste your key in the box first.",
        });
      }
      // Check the key works (and find the best model) before saving it.
      let model;
      if (backup) {
        const picked = await pickBackupModel(backup, clean);
        if (!picked) return json(res, 400, { ok: false, error: `That ${backup.name} key works, but no suitable free model is available right now.` });
        model = picked.model + (picked.vision ? "" : " (can't see pictures)");
      } else {
        model = process.env.GEMINI_MODEL || pickModel(await listChatModels(clean));
      }
      saveEnvValue(ENV_FILE, backup ? backup.envKey : "GEMINI_API_KEY", clean);
      agent.forgetModel();
      agent.warmUp();
      broadcastStatus();
      return json(res, 200, { ok: true, model });
    } catch (error) {
      const message = error instanceof AiError ? error.message : "Couldn't check the key. Try again.";
      return json(res, 400, { ok: false, error: message });
    }
  }

  // The character's picture (optional; the penguin is used otherwise).
  if (url.pathname === "/avatar") {
    try {
      const saved = JSON.parse(readFileSync(AVATAR_FILE, "utf8"));
      res.writeHead(200, { "content-type": saved.type, "cache-control": "no-cache" });
      return res.end(Buffer.from(saved.data, "base64"));
    } catch {
      return json(res, 404, { ok: false });
    }
  }
  if (url.pathname === "/api/avatar" && req.method === "POST") {
    try {
      const body = await readJson(req, 5e6);
      if (body.remove) {
        rmSync(AVATAR_FILE, { force: true });
      } else {
        const match = String(body.image || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
        if (!match) return json(res, 400, { ok: false, error: "Please choose a PNG, JPG, WebP or GIF picture." });
        mkdirSync(path.dirname(AVATAR_FILE), { recursive: true });
        writeFileSync(AVATAR_FILE, JSON.stringify({ type: match[1], data: match[2] }));
      }
      broadcastStatus();
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 400, { ok: false, error: "Couldn't save that picture." });
    }
  }

  // Saved screenshots (for thumbnails in the helper window).
  if (url.pathname.startsWith("/captures/")) {
    const name = path.basename(url.pathname);
    if (!/^cap\d+-\d+\.png$/.test(name)) return json(res, 404, { ok: false });
    try {
      const image = await readFile(path.join(captures.dir, name));
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(image);
    } catch {
      return json(res, 404, { ok: false });
    }
  }

  // Static files for the helper window.
  const file = path.join(CONSOLE_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(CONSOLE_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
});

// ---------- WebSocket hub ----------
// Only our own parts may connect: the helper window (same address), the Chrome
// add-on (chrome-extension://) and the Figma plugin (its iframe reports "null").
function allowedOrigin(origin) {
  if (!origin || origin === "null") return true;
  if (origin.startsWith("chrome-extension://")) return true;
  return origin === URL_BASE || origin === `http://127.0.0.1:${PORT}`;
}

const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient: ({ origin }) => allowedOrigin(origin),
});
wss.on("error", () => {}); // listen errors are handled on the server below

wss.on("connection", (socket) => {
  let role = null;
  let live = null; // this helper window's phone-call voice

  socket.on("message", (raw, isBinary) => {
    // Audio from the helper window's microphone, for the live call.
    if (isBinary) {
      if (role === "console" && live) live.audio(raw);
      return;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === "hello" && clients[message.role]) {
      role = message.role;
      clients[role].add(socket);
      if (role === "console") {
        send(socket, { type: "history", messages: agent.history() });
        const waiting = agent.pendingApproval();
        if (waiting) send(socket, { type: "approval", ...waiting });
        send(socket, { type: "status", ...agent.status(), connections: connections(), settings: settings() });
      } else {
        if (role === "browser") {
          extensionNeedsReload = Number(message.core || 0) < expectedExtensionCore();
          if (extensionNeedsReload) console.log("  The Chrome add-on has an update: reload it once in chrome://extensions.");
        }
        console.log(`  ${role === "browser" ? "Chrome add-on" : "Figma plugin"} connected.`);
        lastActivity[role] = Date.now();
        broadcastStatus();
      }
      return;
    }

    if (role === "browser" || role === "figma") {
      if (message.type === "result") finishCall(message);
      if (message.type === "event" && message.name === "activity") {
        lastActivity[role] = Date.now();
        const detail = message.detail || {};
        if (role === "figma" && detail.file) {
          const changed = detail.file !== figmaFile.name;
          figmaFile = { name: detail.file, key: detail.fileKey || "", page: detail.page || "" };
          captures.rememberFile(detail.file, detail.fileKey || "");
          // A screenshot may be waiting for this file.
          if (changed) agent.figmaFileOpened(detail.file);
        }
      }
      return;
    }

    if (role === "console") {
      if (message.type === "chat" && !(live && live.isOn() && live.text(String(message.text || "")))) agent.handleUserText(message.text);
      if (message.type === "live_start") {
        live = live || liveCallFor(socket);
        live.start({ voice: String(message.voice || "") });
      }
      if (message.type === "live_stop" && live) live.stop();
      if (message.type === "reset") agent.reset();
      // Only a click in the helper window (or your clear "yes") can approve a change.
      if (message.type === "approve") agent.approve(String(message.id || ""));
      if (message.type === "reject") agent.reject(String(message.id || ""));
      if (message.type === "undo") agent.undoLast();
      if (message.type === "setting" && typeof message.autoStartFigma === "boolean") {
        saveEnvValue(ENV_FILE, "AUTO_START_FIGMA", message.autoStartFigma ? "on" : "off");
        broadcastStatus();
      }
      if (message.type === "setting" && typeof message.askBeforeChanges === "boolean") {
        saveEnvValue(ENV_FILE, "ASK_BEFORE_CHANGES", message.askBeforeChanges ? "on" : "off");
        broadcastStatus();
      }
      // The helper window says when to move the pointer (in time with the voice).
      if (message.type === "point") pointAt(String(message.target || ""));
      if (message.type === "point_clear") clearPointers();
    }
  });

  socket.on("close", () => {
    if (live) live.stop();
    if (!role) return;
    clients[role].delete(socket);
    if (role === "figma" && !clients.figma.size) figmaFile = { name: "", key: "", page: "" };
    if (role !== "console") {
      if (!clients[role].size) console.log(`  ${role === "browser" ? "Chrome add-on" : "Figma plugin"} disconnected.`);
      broadcastStatus();
    }
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`\n  Another copy of Design Agent is already running (port ${PORT}), and it didn't close.`);
    console.log("  Close any other black Design Agent windows, then start it again.");
    console.log("  If you can't find one, restart your computer.\n");
    if (shouldOpen) openWindow(URL_BASE);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("\n  Design Agent is running.");
  console.log(`  Helper window: ${URL_BASE}`);
  console.log("  Keep this window open while you work. Close it to stop Design Agent.\n");
  if (!process.env.GEMINI_API_KEY) console.log("  First time? The helper window will ask for your free Gemini key.\n");
  if (shouldOpen) openWindow(URL_BASE);
  agent.warmUp();
  autostart.start();
});
