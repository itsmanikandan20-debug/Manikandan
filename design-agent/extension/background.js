// Design Agent Chrome add-on: connects Chrome to the Design Agent running on this computer.
// It only reads a page when the agent asks (when you ask about the page you're looking at).
// This file is the add-on's "core" and rarely changes. The page-reading code lives in
// snapshot.js, which is read fresh each time, so it updates without reloading the add-on.

const SERVER = "ws://localhost:3456/ws";
const STATUS_URL = "http://localhost:3456/api/status";
// Raise this whenever background.js or manifest.json change, so the helper can ask
// you to reload the add-on once (Chrome only picks up those two files on reload).
const CORE_VERSION = 6;
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

// Tell Design Agent when you're working in Chrome, so "this" means the web page.
function reportActivity() {
  send({ type: "event", name: "activity" });
}
chrome.tabs.onActivated.addListener(reportActivity);
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "complete" && tab.active) reportActivity();
});
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const win = await chrome.windows.get(windowId);
    if (win.type === "normal") reportActivity(); // not the helper window
  } catch {
    // window already closed
  }
});

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
  if (tool === "web.screenshot") return screenshot(args);
  if (tool === "web.open_tabs") return openTabs(args);
  if (tool === "web.list_tabs") return listTabs();
  throw new Error(`unknown tool ${tool}`);
}

/** Opens web addresses as new tabs in your Chrome window (the first one comes to the front). */
async function openTabs({ urls = [] }) {
  const clean = urls.filter((u) => /^https?:\/\/\S+$/i.test(String(u))).slice(0, 15);
  if (!clean.length) throw new Error("no valid web addresses");
  let win = null;
  try {
    win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch {
    win = null;
  }
  if (!win) win = await chrome.windows.create({ focused: true });
  const opened = [];
  for (let i = 0; i < clean.length; i++) {
    const tab = await chrome.tabs.create({ windowId: win.id, url: clean[i], active: i === 0 });
    opened.push({ tabId: tab.id, url: clean[i] });
  }
  await chrome.windows.update(win.id, { focused: true }).catch(() => {});
  return { opened };
}

/** The website tabs in your Chrome window, left to right. */
async function listTabs() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  const tabs = await chrome.tabs.query({ windowId: win.id });
  return { tabs: tabs.filter((t) => /^https?:/i.test(t.url || "")).map((t) => ({ tabId: t.id, url: t.url, title: t.title || "" })) };
}

/** Brings a tab to the front and waits until it has finished loading. */
async function showTab(tabId) {
  let tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  for (let i = 0; i < 60 && tab.status !== "complete"; i++) {
    await wait(500);
    tab = await chrome.tabs.get(tabId);
  }
  await wait(1200); // let fonts, images and animations settle
  return chrome.tabs.get(tabId);
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

// ---------- screenshots ----------
const MAX_SLICE = 4096; // Figma accepts images up to 4096 px on each side
const MAX_PAGE_HEIGHT = 16000; // CSS px, for very long pages
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inPage(tabId, method, args = []) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["capture.js"] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (name, params) => window.__designAgent[name](...params),
    args: [method, args],
  });
  return injection.result;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function bitmapOf(dataUrl) {
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

/** Takes a screenshot of the visible part, or of the whole page (scrolling and stitching). */
async function screenshot({ fullPage = false, tabId = null } = {}) {
  const tab = tabId ? await showTab(tabId) : await currentTab();
  if (!/^(https?|file):/i.test(tab.url || "")) throw new Error("Chrome doesn't let add-ons capture its own pages. Open a normal website.");
  const info = await inPage(tab.id, "captureStart");
  const shots = [];
  try {
    const cssHeight = fullPage ? Math.min(info.pageHeight, MAX_PAGE_HEIGHT) : info.height;
    const positions = [];
    if (fullPage) {
      for (let y = 0; y < cssHeight; y += info.height) positions.push(Math.min(y, Math.max(cssHeight - info.height, 0)));
    } else {
      positions.push(null); // just what's on screen
    }
    let lastCapture = 0;
    for (let i = 0; i < positions.length; i++) {
      let y = null;
      if (positions[i] !== null) {
        y = await inPage(tab.id, "captureScrollTo", [positions[i], i > 0]);
        await wait(300); // let lazy images and animations settle
      }
      const since = Date.now() - lastCapture;
      if (since < 600) await wait(600 - since); // Chrome allows about 2 captures per second
      await wait(80); // make sure the hidden pointer has repainted
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      lastCapture = Date.now();
      shots.push({ y: y === null ? 0 : y, dataUrl });
    }

    // Stitch the shots into one tall picture, then cut it into slices Figma accepts.
    const first = await bitmapOf(shots[0].dataUrl);
    const scale = first.width / info.width; // device pixels per CSS pixel
    const width = first.width;
    const height = Math.round(cssHeight * scale);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(first, 0, Math.round(shots[0].y * scale));
    for (const shot of shots.slice(1)) ctx.drawImage(await bitmapOf(shot.dataUrl), 0, Math.round(shot.y * scale));

    const chunks = [];
    for (let top = 0; top < height; top += MAX_SLICE) {
      const sliceHeight = Math.min(MAX_SLICE, height - top);
      const slice = new OffscreenCanvas(Math.min(width, MAX_SLICE), sliceHeight);
      slice.getContext("2d").drawImage(canvas, 0, top, slice.width, sliceHeight, 0, 0, slice.width, sliceHeight);
      const blob = await slice.convertToBlob({ type: "image/png" });
      chunks.push({ base64: toBase64(await blob.arrayBuffer()), width: slice.width, height: sliceHeight });
    }
    return { url: info.url, title: info.title, fullPage, cssWidth: Math.round(Math.min(width, MAX_SLICE) / scale), cssHeight, chunks };
  } finally {
    await inPage(tab.id, "captureEnd").catch(() => {});
  }
}
