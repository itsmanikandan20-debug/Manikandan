"use client";

import type { AnalysisResult } from "./types";

// No database in this MVP — analyses live in the browser's storage. That
// keeps the whole project deployable on Vercel's free tier with zero
// setup, at the cost of history not following you across devices/browsers.
// (Documented as an MVP limitation in the README.)
//
// Two different browser storages are used on purpose. All the small stuff —
// scores, issues, text, warnings — goes in localStorage, which is simple
// and synchronous but capped at roughly 5-10MB per site. Screenshots and
// design thumbnails go in IndexedDB instead, which browsers grant far more
// room to (typically hundreds of MB or more) — a single real full-page
// screenshot, or a Figma/SVG thumbnail with embedded photos, can easily be
// several MB on its own, which kept exceeding localStorage's much smaller
// budget no matter how much the images themselves were compressed.

const RESULT_PREFIX = "designcheck:result:";
const HISTORY_KEY = "designcheck:history";
const MAX_HISTORY = 30;
const DB_NAME = "designcheck-images";
const DB_VERSION = 1;
const STORE_NAME = "images";

type HistoryEntry = {
  id: string;
  createdAt: string;
  figmaUrl: string;
  websiteUrl: string;
  overallScore: number;
  issueCount: number;
  isDemo: boolean;
};

interface ImageBundle {
  figmaThumbnail?: string;
  websiteScreenshot?: string;
  responsiveScreenshots?: (string | undefined)[];
}

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

// ---- IndexedDB (screenshots + thumbnails) ---------------------------------

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putImages(id: string, images: ImageBundle): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(images, id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function getImages(id: string): Promise<ImageBundle | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as ImageBundle) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function deleteImagesFor(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

function extractImages(result: AnalysisResult): ImageBundle {
  return {
    figmaThumbnail: result.figma.thumbnailUrl,
    websiteScreenshot: result.website.screenshotDataUrl,
    responsiveScreenshots: result.responsive.map((r) => r.screenshotDataUrl),
  };
}

function hasAnyImage(images: ImageBundle): boolean {
  return Boolean(images.figmaThumbnail || images.websiteScreenshot || images.responsiveScreenshots?.some(Boolean));
}

function withoutImages(result: AnalysisResult): AnalysisResult {
  return {
    ...result,
    figma: { ...result.figma, thumbnailUrl: undefined },
    website: { ...result.website, screenshotDataUrl: undefined },
    responsive: result.responsive.map((r) => ({ ...r, screenshotDataUrl: undefined })),
  };
}

function withImages(result: AnalysisResult, images: ImageBundle): AnalysisResult {
  return {
    ...result,
    figma: { ...result.figma, thumbnailUrl: images.figmaThumbnail ?? result.figma.thumbnailUrl },
    website: { ...result.website, screenshotDataUrl: images.websiteScreenshot ?? result.website.screenshotDataUrl },
    responsive: result.responsive.map((r, i) => ({
      ...r,
      screenshotDataUrl: images.responsiveScreenshots?.[i] ?? r.screenshotDataUrl,
    })),
  };
}

// ---- localStorage (metadata: scores, issues, text) -------------------------

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

// With images no longer part of this payload, what's left (scores, issues,
// warnings, plain text) is small — a handful of KB even for a large
// analysis — so this should essentially always fit. Eviction stays as a
// defensive fallback for a browser with almost no quota left at all, not
// the normal path anymore.
function evictOldestUntilFits(newEntryJson: string, key: string): boolean {
  const history = loadHistory();
  // Oldest last, since loadHistory()/writeHistoryEntry() keep newest-first.
  for (let i = history.length - 1; i >= 0; i--) {
    const victim = history[i];
    if (victim.id === key.replace(RESULT_PREFIX, "")) continue; // never evict the one we're saving
    localStorage.removeItem(RESULT_PREFIX + victim.id);
    history.splice(i, 1);
    void deleteImagesFor(victim.id);
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

export async function saveAnalysis(result: AnalysisResult): Promise<SaveOutcome> {
  const key = RESULT_PREFIX + result.id;
  const images = extractImages(result);
  const withImagesToSave = hasAnyImage(images);

  const imagesSaved = withImagesToSave ? await putImages(result.id, images) : true;

  const metaOnly = withoutImages(result);
  if (withImagesToSave && !imagesSaved) {
    metaOnly.warnings = [
      ...metaOnly.warnings,
      "Screenshots couldn't be saved in this browser (its image storage is unavailable or full). Every score, issue, and detail below is still fully accurate; only the side-by-side images are missing.",
    ];
  }
  const metaJson = JSON.stringify(metaOnly);

  let metaSaved = false;
  try {
    localStorage.setItem(key, metaJson);
    metaSaved = true;
  } catch (err) {
    if (isQuotaExceeded(err) && evictOldestUntilFits(metaJson, key)) metaSaved = true;
  }
  if (!metaSaved) return "failed";

  writeHistoryEntry(result);
  return withImagesToSave && !imagesSaved ? "without-images" : "full";
}

// Wipes every saved analysis and history entry in this browser — the
// blunt, one-click way to recover storage space, offered on the History
// page next to deleting entries one at a time.
export async function clearAllAnalyses(): Promise<void> {
  const ids = loadHistory().map((h) => h.id);
  safe(() => {
    for (const entry of loadHistory()) {
      localStorage.removeItem(RESULT_PREFIX + entry.id);
    }
    localStorage.removeItem(HISTORY_KEY);
    return null;
  }, null);
  await Promise.all(ids.map((id) => deleteImagesFor(id)));
}

export async function loadAnalysis(id: string): Promise<AnalysisResult | null> {
  const metaOnly = safe(() => {
    const raw = localStorage.getItem(RESULT_PREFIX + id);
    return raw ? (JSON.parse(raw) as AnalysisResult) : null;
  }, null);
  if (!metaOnly) return null;

  const images = await getImages(id);
  return images ? withImages(metaOnly, images) : metaOnly;
}

export function loadHistory(): HistoryEntry[] {
  return safe(() => {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  }, []);
}

export async function deleteAnalysis(id: string): Promise<void> {
  safe(() => {
    localStorage.removeItem(RESULT_PREFIX + id);
    const next = loadHistory().filter((h) => h.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    return null;
  }, null);
  await deleteImagesFor(id);
}

export type { HistoryEntry };
