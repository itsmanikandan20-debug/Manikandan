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

export function saveAnalysis(result: AnalysisResult): SaveOutcome {
  try {
    localStorage.setItem(RESULT_PREFIX + result.id, JSON.stringify(result));
    writeHistoryEntry(result);
    return "full";
  } catch (err) {
    if (!isQuotaExceeded(err)) return "failed";
  }

  // Retry once, without the large embedded images.
  try {
    localStorage.setItem(RESULT_PREFIX + result.id, JSON.stringify(stripImages(result)));
    writeHistoryEntry(result);
    return "without-images";
  } catch {
    return "failed";
  }
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
