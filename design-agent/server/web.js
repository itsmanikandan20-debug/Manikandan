// Searching the internet and opening websites in the user's Chrome.
// Search uses DuckDuckGo (free, no key). If that doesn't answer, it asks Gemini with
// Google Search turned on. Opening sites starts Chrome with those addresses as new tabs.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function decodeHtml(text) {
  return String(text)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo's plain HTML results: [{ title, url, snippet }]. */
async function duckDuckGo(query, count) {
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: new URLSearchParams({ q: query, kl: "wt-wt" }).toString(),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`search answered ${response.status}`);
  const html = await response.text();
  const results = [];
  const blocks = html.split(/class="result results_links|class="result results_links_deep/).slice(1);
  for (const block of blocks) {
    if (/result--ad/.test(block.slice(0, 200))) continue; // skip adverts
    const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    let url = link[1].replace(/&amp;/g, "&");
    const redirect = url.match(/[?&]uddg=([^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (url.startsWith("//")) url = "https:" + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    results.push({ title: decodeHtml(link[2]), url, snippet: snippet ? decodeHtml(snippet[1]).slice(0, 240) : "" });
    if (results.length >= count) break;
  }
  return results;
}

/** Gemini with Google Search: a short answer plus its sources. */
async function geminiSearch(query, key, model) {
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  const response = await fetch(`${base}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `Search the web and answer briefly, listing the main sources: ${query}` }] }],
      tools: [{ google_search: {} }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Google search answered ${response.status}`);
  const data = await response.json();
  const candidate = (data.candidates || [])[0] || {};
  const answer = ((candidate.content || {}).parts || []).map((p) => p.text || "").join("");
  const chunks = (candidate.groundingMetadata || {}).groundingChunks || [];
  const sources = chunks.filter((c) => c.web).map((c) => ({ title: c.web.title, url: c.web.uri, snippet: "" }));
  return { answer, sources };
}

/** Searches the internet. Returns { results: [{ title, url, snippet }], answer?, via }. */
export async function searchWeb(query, count = 8, gemini = null) {
  const wanted = Math.max(1, Math.min(Number(count) || 8, 20));
  try {
    const results = await duckDuckGo(query, wanted);
    if (results.length) return { via: "DuckDuckGo", results };
  } catch (error) {
    console.log(`  DuckDuckGo search didn't work (${error.message}); trying Google via Gemini.`);
  }
  if (gemini && gemini.key && gemini.model) {
    const { answer, sources } = await geminiSearch(query, gemini.key, gemini.model);
    return { via: "Google (Gemini)", answer, results: sources.slice(0, wanted) };
  }
  throw new Error("the web search didn't answer. Check your internet connection.");
}

function findChrome() {
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      const file = path.join(root, "Google", "Chrome", "Application", "chrome.exe");
      if (existsSync(file)) return file;
    }
    return null;
  }
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return "google-chrome";
}

/** Opens web addresses as new tabs in the user's Chrome. Returns the ones opened. */
export function openInChrome(urls) {
  const clean = [...new Set((urls || []).map((u) => String(u).trim()).filter((u) => /^https?:\/\/[^\s]+$/i.test(u)))].slice(0, 15);
  if (!clean.length) throw new Error("no valid web addresses (they must start with http:// or https://)");
  const chrome = findChrome();
  try {
    if (chrome && (process.platform !== "win32" || existsSync(chrome))) {
      spawn(chrome, clean, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    } else if (process.platform === "win32") {
      for (const url of clean) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else {
      for (const url of clean) spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    }
  } catch (error) {
    throw new Error(`couldn't open Chrome (${error.message})`);
  }
  return clean;
}
