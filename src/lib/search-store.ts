"use client";

// No database yet, so a real search's results only live in the browser:
// sessionStorage for "the search you just ran" (read by /results, /compare),
// localStorage for a running history list (read by /history, the dashboard).
// This means history is per-browser, not per-account — see README.

import type { SearchRecord } from "./types";

const LAST_SEARCH_KEY = "dsf:lastSearch";
const HISTORY_KEY = "dsf:history";
const MAX_HISTORY = 20;

export function saveLastSearch(record: SearchRecord) {
  try {
    sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(record));
  } catch {
    // Private browsing / storage disabled — the app still works, just
    // without carrying the record across pages.
  }
}

export function loadLastSearch(): SearchRecord | null {
  try {
    const raw = sessionStorage.getItem(LAST_SEARCH_KEY);
    return raw ? (JSON.parse(raw) as SearchRecord) : null;
  } catch {
    return null;
  }
}

export function appendHistory(record: SearchRecord) {
  try {
    const next = [record, ...loadRealHistory()].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
}

export function loadRealHistory(): SearchRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as SearchRecord[]) : [];
  } catch {
    return [];
  }
}

export interface DashboardStats {
  searchesThisMonth: number;
  liveVerifiedCount: number;
  avgTopSimilarity: number | null;
}

export function computeStats(history: SearchRecord[]): DashboardStats {
  const now = new Date();
  const searchesThisMonth = history.filter((record) => {
    const created = new Date(record.createdAt);
    return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
  }).length;

  const liveVerifiedCount = history.reduce(
    (sum, record) => sum + record.results.filter((match) => match.stage === "live_verified").length,
    0
  );

  const topScores = history
    .map((record) => record.results[0]?.similarityScore)
    .filter((score): score is number => typeof score === "number");
  const avgTopSimilarity = topScores.length
    ? Math.round(topScores.reduce((a, b) => a + b, 0) / topScores.length)
    : null;

  return { searchesThisMonth, liveVerifiedCount, avgTopSimilarity };
}
