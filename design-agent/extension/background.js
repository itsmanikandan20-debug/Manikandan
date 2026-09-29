// Design Agent Chrome add-on: connects Chrome to the Design Agent running on this computer.
// It only reads a page when the agent asks (when you ask about the page you're looking at).
// This file is the add-on's "core" and rarely changes. The page-reading code lives in
// snapshot.js, which is read fresh each time, so it updates without reloading the add-on.

const SERVER = "ws://localhost:3456/ws";
const STATUS_URL = "http://localhost:3456/api/status";
// Raise this whenever background.js or manifest.json change, so the helper can ask
// you to reload the add-on once (Chrome only picks up those two files on reload).
const CORE_VERSION = 3;
let socket = null;
let pingTimer = null;
let checking = false;
let retryTimer = null;

function retrySoon() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, 3000);
}

// ---------- connection ----------
async function connect() {
  if (checking) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  // Check quietly whether Design Agent is running before connecting. A failed
  // WebSocket shows up as a red "Errors" button in chrome://extensions; a failed
  // check like this one doesn't.
  checking = true;
  try {
    await fetch(STATUS_URL, { cache: "no-store" });
  } catch {
    checking = false;
    retrySoon(); // not running yet; try again in a moment
    return;
  }
  checking = false;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  try {
    socket = new WebSocket(SERVER);
  } catch {
    return;
  }
  socket.onopen = () => {
    send({ type: "hello", role: "browser", version: chrome.runtime.getManifest().version, core: CORE_VERSION });
    clearInterval(pingTimer);
    // Regular messages keep Chrome from putting the add-on to sleep.
    pingTimer = setInterval(() => send({ type: "ping" }), 20000);
  };
  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handle(message);
  };
  socket.onclose = () => {
    clearInterval(pingTimer);
    socket = null;
    retrySoon(); // Design Agent stopped; keep checking quietly
  };
  socket.onerror = () => {};
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

// Wake up regularly in case Chrome stopped the add-on in the background.
chrome.alarms.create("keep-connected", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

// ---------- messages from Design Agent ----------
async function handle(message) {

  if (message.type === "request") {
    try {
      const data = await runTool(message.tool, message.args || {});
      send({ type: "result", id: message.id, ok: true, data });
    } catch (error) {
      send({ type: "result", id: message.id, ok: false, error: error.message || String(error) });
    }
  }
}

// ---------- tools ----------
async function currentTab() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab) throw new Error("no Chrome tab is open");
  return tab;
}

let lastReadTabId = null; // the tab we last described; element ids like w12 live there

async function runTool(tool, args) {
  if (tool === "web.snapshot") return snapshot();
  if (tool === "page.call") return pageCall(args);
  throw new Error(`unknown tool ${tool}`);
}

/**
 * Runs a helper file inside the page, then calls one of its functions.
 * Page features (like the pointer) live in their own files, so they can be
 * updated without reloading the add-on. Example: { file: "pointer.js", method: "show", args: ["w12"] }
 */
async function pageCall({ file, method, args = [] }) {
  if (!/^[\w-]+\.js$/.test(file || "") || !/^\w+$/.test(method || "")) throw new Error("bad page call");
  let tabId = lastReadTabId;
  try {
    if (tabId === null) throw new Error();
    await chrome.tabs.get(tabId);
  } catch {
    tabId = (await currentTab()).id;
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (name, params) => {
      const api = window.__designAgent;
      if (!api || typeof api[name] !== "function") return { ok: false, reason: `missing ${name}` };
      return api[name](...params);
    },
    args: [method, args],
  });
  return injection.result;
}

async function snapshot() {
  const tab = await currentTab();
  const url = tab.url || "";
  if (!/^(https?|file):/i.test(url)) {
    throw new Error(
      url.startsWith("chrome")
        ? "the Chrome tab shows a built-in Chrome page, which add-ons aren't allowed to read. Open a normal website."
        : "this tab can't be read. Open a normal website.",
    );
  }
  if (/^https:\/\/chromewebstore\.google\.com|^https:\/\/chrome\.google\.com\/webstore/i.test(url)) {
    throw new Error("Chrome doesn't let add-ons read the Chrome Web Store. Open another website.");
  }

  let page;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["snapshot.js"] });
    page = injection.result;
    lastReadTabId = tab.id;
  } catch (error) {
    if (/file:/.test(url)) {
      throw new Error("to read files on your computer, turn on \"Allow access to file URLs\" for Design Agent in chrome://extensions");
    }
    throw new Error("Chrome didn't let me read this page (" + (error.message || "unknown reason") + ")");
  }

  let screenshot = null;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
    screenshot = dataUrl.split(",")[1];
  } catch {
    // The window may be minimised; the page description still works without a picture.
  }
  return { ...page, screenshot };
}
