// The local server: the "brain" of Design Agent.
// It serves the helper window, and every part (helper window, Chrome add-on,
// Figma plugin) connects to it over a WebSocket at ws://localhost:PORT/ws.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { loadEnv, saveEnvValue } from "./env.js";
import { createAgent } from "./agent/agent.js";
import { AiError, listChatModels, pickModel } from "./ai/gemini.js";
import { openWindow } from "./open-window.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env");
const CONSOLE_DIR = path.join(ROOT, "console");

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
  return { browser: clients.browser.size > 0, figma: clients.figma.size > 0 };
}
function broadcastStatus() {
  broadcast({ type: "status", ...agent.status(), connections: connections() });
}

const agent = createAgent({ broadcast });

// ---------- web server ----------
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1e6) throw new Error("too large");
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
      const { key } = await readJson(req);
      // Remove spaces, line breaks and quotes that often come along when copying.
      const clean = String(key || "").replace(/[\s"'`]/g, "");
      if (clean.length < 20) {
        return json(res, 400, {
          ok: false,
          error: clean
            ? `That's too short to be a key (${clean.length} characters). Use the Copy button next to your key on aistudio.google.com/apikey.`
            : "Paste your key in the box first.",
        });
      }
      const model = process.env.GEMINI_MODEL || pickModel(await listChatModels(clean));
      saveEnvValue(ENV_FILE, "GEMINI_API_KEY", clean);
      agent.forgetModel();
      agent.warmUp();
      broadcastStatus();
      return json(res, 200, { ok: true, model });
    } catch (error) {
      const message = error instanceof AiError ? error.message : "Couldn't check the key. Try again.";
      return json(res, 400, { ok: false, error: message });
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

  socket.on("message", (raw) => {
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
        send(socket, { type: "status", ...agent.status(), connections: connections() });
      } else {
        broadcastStatus();
      }
      return;
    }

    if (role === "console") {
      if (message.type === "chat") agent.handleUserText(message.text);
      if (message.type === "reset") agent.reset();
    }
  });

  socket.on("close", () => {
    if (!role) return;
    clients[role].delete(socket);
    if (role !== "console") broadcastStatus();
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
});
