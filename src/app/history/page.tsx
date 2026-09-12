"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2, Sparkles, Eraser } from "lucide-react";
import { loadHistory, deleteAnalysis, clearAllAnalyses, type HistoryEntry } from "@/lib/storage";

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  function remove(id: string) {
    deleteAnalysis(id);
    setHistory(loadHistory());
  }

  function clearAll() {
    if (!confirm(`Delete all ${history.length} saved analyses from this browser? This can't be undone.`)) return;
    clearAllAnalyses();
    setHistory([]);
  }

  return (
    <main className="mx-auto max-w-content px-6 py-10 lg:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Analysis History</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Stored in this browser only — there&apos;s no account system in this MVP, so history won&apos;t follow you to another device.
          </p>
        </div>
        {history.length > 0 && (
          <button
            onClick={clearAll}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold text-ink-soft hover:bg-severity-high-bg hover:text-severity-high"
          >
            <Eraser size={15} /> Clear all
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface-sunken p-10 text-center">
          <p className="text-sm text-ink-muted">No analyses yet.</p>
          <Link href="/" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">
            Run your first analysis
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {history.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-white p-4 shadow-sm">
              <Link href={`/results/${entry.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{entry.websiteUrl}</p>
                  {entry.isDemo && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                      <Sparkles size={10} /> Demo
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-muted">{entry.figmaUrl}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {new Date(entry.createdAt).toLocaleString()} · Score {entry.overallScore}% · {entry.issueCount} issues
                </p>
              </Link>
              <button
                onClick={() => remove(entry.id)}
                className="shrink-0 rounded-lg p-2 text-ink-muted hover:bg-severity-high-bg hover:text-severity-high"
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
