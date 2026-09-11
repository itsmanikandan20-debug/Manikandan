"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { loadAnalysis } from "@/lib/storage";
import type { AnalysisResult, Issue, Severity } from "@/lib/types";

const SEVERITY_COLOR: Record<Severity, string> = { high: "#E4342A", medium: "#C4790A", low: "#2F6FED" };

function DemoSiteInner() {
  const params = useSearchParams();
  const analysisId = params.get("analysisId");
  const issueId = params.get("issueId");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (analysisId) setAnalysis(loadAnalysis(analysisId));
  }, [analysisId]);

  const issue: Issue | undefined = analysis?.issues.find((i) => i.id === issueId);

  useEffect(() => {
    if (!issue?.boundingBox || !natural || !containerRef.current) return;
    const ratio = issue.boundingBox.y / natural.h;
    const target = containerRef.current.scrollHeight * ratio - 160;
    containerRef.current.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [issue, natural]);

  if (!analysis) {
    return <main className="mx-auto max-w-content px-6 py-20 text-center text-sm text-ink-muted">Loading…</main>;
  }

  const box = issue?.boundingBox;
  const color = issue ? SEVERITY_COLOR[issue.severity] : "#E4342A";

  return (
    <main className="min-h-screen bg-surface-sunken">
      <div className="sticky top-[57px] z-30 flex items-center justify-between gap-3 border-b border-border bg-ink px-6 py-2.5 text-white">
        <div className="flex items-center gap-2 text-xs">
          <Info size={14} />
          Simulated live website (Demo Mode) — showing where issue #{issue?.number} would be highlighted on the real page.
        </div>
        <Link href={`/results/${analysis.id}`} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold hover:underline">
          <ArrowLeft size={13} /> Back to results
        </Link>
      </div>

      <div ref={containerRef} className="mx-auto max-h-[calc(100vh-100px)] max-w-5xl overflow-y-auto py-6">
        <div className="relative rounded-xl border border-border bg-white shadow-panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={analysis.website.screenshotDataUrl}
            alt="Live website"
            className="block w-full"
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          {natural && box && (
            <>
              <div
                className="absolute animate-pulse rounded-[4px]"
                style={{
                  left: `${(box.x / natural.w) * 100}%`,
                  top: `${(box.y / natural.h) * 100}%`,
                  width: `${(box.width / natural.w) * 100}%`,
                  height: `${(box.height / natural.h) * 100}%`,
                  border: `3px solid ${color}`,
                  boxShadow: `0 0 0 4px ${color}33`,
                }}
              />
              <div
                className="absolute -translate-y-full whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg"
                style={{
                  left: `${(box.x / natural.w) * 100}%`,
                  top: `${(box.y / natural.h) * 100}%`,
                  backgroundColor: "#181321",
                  marginTop: -6,
                }}
              >
                Issue #{issue?.number} — Fix this element
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function DemoSitePage() {
  return (
    <Suspense fallback={null}>
      <DemoSiteInner />
    </Suspense>
  );
}
