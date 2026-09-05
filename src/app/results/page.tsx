"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Header } from "@/components/Header";
import { ResultCard } from "@/components/ResultCard";
import { loadLastSearch } from "@/lib/search-store";
import type { SearchRecord } from "@/lib/types";

export default function ResultsPage() {
  const [record, setRecord] = useState<SearchRecord | null | undefined>(undefined);

  useEffect(() => {
    setRecord(loadLastSearch());
  }, []);

  if (record === undefined) {
    return (
      <>
        <Header title="Search results" />
        <main className="mx-auto max-w-content px-6 py-8 lg:px-10">
          <p className="text-sm text-ink-muted">Loading…</p>
        </main>
      </>
    );
  }

  if (!record) {
    return (
      <>
        <Header title="Search results" description="No search yet" />
        <main className="mx-auto max-w-content px-6 py-8 lg:px-10">
          <div className="rounded-2xl border border-border bg-white p-8 text-center shadow-panel">
            <p className="text-sm text-ink-muted">
              You haven&apos;t uploaded a screenshot yet in this browser session.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              Go to upload
            </Link>
          </div>
        </main>
      </>
    );
  }

  const { design, results } = record;
  const verifiedCount = results.filter((m) => m.stage === "live_verified").length;
  const notFoundCount = results.filter((m) => m.stage === "source_not_found").length;

  return (
    <>
      <Header
        title="Search results"
        description={`${results.length} candidate match${results.length === 1 ? "" : "es"} for ${design.fileName}`}
      />

      <main className="mx-auto max-w-content px-6 py-8 lg:px-10">
        <section className="flex flex-col gap-5 rounded-2xl border border-border bg-white p-5 shadow-panel sm:flex-row sm:items-center">
          <div className="h-28 w-full shrink-0 overflow-hidden rounded-xl border border-border sm:w-40">
            <Image
              src={design.imageUrl}
              alt={design.fileName}
              width={480}
              height={360}
              unoptimized
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-ink">{design.fileName}</p>
            <p className="mt-1 text-sm text-ink-muted">{design.detectedLayout}</p>
            <div className="mt-3 flex items-center gap-2">
              {design.dominantColors.map((color) => (
                <span
                  key={color}
                  title={color}
                  className="h-6 w-6 rounded-full border border-border"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-6 border-t border-border pt-4 sm:border-t-0 sm:border-l sm:pl-6 sm:pt-0">
            <div>
              <p className="text-xl font-semibold text-ink font-display">{verifiedCount}</p>
              <p className="text-xs text-ink-muted">Live verified</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-ink font-display">{notFoundCount}</p>
              <p className="text-xs text-ink-muted">Source not found</p>
            </div>
          </div>
        </section>

        <p className="mt-6 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-xs text-violet-800">
          Scores are an approximate ranking from the visual-match search, not a precise measurement.
          Always check the badge to see whether the source has been identified and verified before
          assuming it&apos;s the original design.
        </p>

        {results.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-white p-8 text-center shadow-panel">
            <p className="text-sm text-ink-muted">No similar live websites were found for this design.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {results.map((result) => (
              <ResultCard key={result.id} result={result} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
