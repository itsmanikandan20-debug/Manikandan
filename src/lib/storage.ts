"use client";

import type { AnalysisResult } from "./types";

// No database in this MVP — analyses live in the browser's localStorage.
// That keeps the whole project deployable on Vercel's free tier with zero
// setup, at the cost of history not following you across devices/browsers.
// (Documented as an MVP limitation in the README.)

const RESULT_PREFIX = "designcheck:result:";
const HISTORY_KEY = "designcheck:history";
const MAX_HISTORY = 30;

type HistoryEntry = {
  id: string;
  createdAt: string;
  figmaUrl: string;
  websiteUrl: string;
  overallScore: number;
  issueCount: number;
  isDemo: boolean;
};

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function isQuotaExceeded(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22)
  );
}

// A full-page website screenshot plus a design thumbnail can add up to
// several megabytes — easily enough to exceed a browser's localStorage
// quota (typically ~5-10MB per site). Rather than let that failure
// silently drop the whole analysis (which used to send people to a
// results page that was never actually saved), this strips the large
// embedded images and retries — keeping every score, issue, and text
// field intact, just without the screenshots the UI already knows how
// to display an empty state for.
function stripImages(result: AnalysisResult): AnalysisResult {
  return {
    ...result,
    figma: { ...result.figma, thumbnailUrl: undefined },
    website: { ...result.website, screenshotDataUrl: undefined },
    responsive: result.responsive.map((r) => ({ ...r, screenshotDataUrl: undefined })),
    warnings: [
      ...result.warnings,
      "Screenshots couldn't be saved — your browser's storage for this site is nearly full (the app automatically freed space by removing some older analyses; you can also do this yourself anytime from History). Every score, issue, and detail below is still fully accurate; only the side-by-side images are missing.",
    ],
  };
}

function writeHistoryEntry(result: AnalysisResult) {
  const history = loadHistory();
  const entry: HistoryEntry = {
    id: result.id,
    createdAt: result.createdAt,
    figmaUrl: result.figmaUrl,
    websiteUrl: result.websiteUrl,
    overallScore: result.overallScore,
    issueCount: result.issues.length,
    isDemo: result.isDemo,
  };
  const next = [entry, ...history.filter((h) => h.id !== result.id)].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

export type SaveOutcome = "full" | "without-images" | "failed";

// If freeing up this one entry's images still doesn't fit, the browser's
// storage for this site is full from *previous* saved analyses piling up
// (every Demo run and real analysis gets saved) — not just this one being
// large. Rather than keep telling the designer to go clear things
// manually, evict the oldest saved analyses automatically, oldest first,
// until the new one fits or there's nothing left to evict.
function evictOldestUntilFits(newEntryJson: string, key: string): boolean {
  const history = loadHistory();
  // Oldest last, since loadHistory()/writeHistoryEntry() keep newest-first.
  for (let i = history.length - 1; i >= 0; i--) {
    const victim = history[i];
    if (victim.id === key.replace(RESULT_PREFIX, "")) continue; // never evict the one we're saving
    localStorage.removeItem(RESULT_PREFIX + victim.id);
    history.splice(i, 1);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      localStorage.setItem(key, newEntryJson);
      return true;
    } catch (err) {
      if (!isQuotaExceeded(err)) return false;
      // still doesn't fit — keep evicting
    }
  }
  return false;
}

export function saveAnalysis(result: AnalysisResult): SaveOutcome {
  const key = RESULT_PREFIX + result.id;

  try {
    localStorage.setItem(key, JSON.stringify(result));
    writeHistoryEntry(result);
    return "full";
  } catch (err) {
    if (!isQuotaExceeded(err)) return "failed";
  }

  // Retry without this entry's own large embedded images.
  const strippedJson = JSON.stringify(stripImages(result));
  try {
    localStorage.setItem(key, strippedJson);
    writeHistoryEntry(result);
    return "without-images";
  } catch (err) {
    if (!isQuotaExceeded(err)) return "failed";
  }

  // Still doesn't fit — the accumulated history itself is the problem.
  // Free space by evicting old analyses, then try the stripped version
  // one more time.
  if (evictOldestUntilFits(strippedJson, key)) {
    writeHistoryEntry(result);
    return "without-images";
  }

  return "failed";
}

// Wipes every saved analysis and history entry in this browser — the
// blunt, one-click way to recover storage space, offered on the History
// page next to deleting entries one at a time.
export function clearAllAnalyses() {
  safe(() => {
    for (const entry of loadHistory()) {
      localStorage.removeItem(RESULT_PREFIX + entry.id);
    }
    localStorage.removeItem(HISTORY_KEY);
    return null;
  }, null);
}

export function loadAnalysis(id: string): AnalysisResult | null {
  return safe(() => {
    const raw = localStorage.getItem(RESULT_PREFIX + id);
    return raw ? (JSON.parse(raw) as AnalysisResult) : null;
  }, null);
}

export function loadHistory(): HistoryEntry[] {
  return safe(() => {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  }, []);
}

export function deleteAnalysis(id: string) {
  safe(() => {
    localStorage.removeItem(RESULT_PREFIX + id);
    const next = loadHistory().filter((h) => h.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    return null;
  }, null);
}

export type { HistoryEntry };
