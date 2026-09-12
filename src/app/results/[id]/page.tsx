"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FileText, RefreshCcw, Sparkles } from "lucide-react";
import type { AnalysisResult, Issue, IssueCategory, IssueStatus, Severity } from "@/lib/types";
import { loadAnalysis, saveAnalysis } from "@/lib/storage";
import { ScoreGauge } from "@/components/ScoreGauge";
import { CategoryBar } from "@/components/CategoryBar";
import { ScreenshotCompare } from "@/components/ScreenshotCompare";
import { IssueCard } from "@/components/IssueCard";
import { IssueDetailPanel } from "@/components/IssueDetailPanel";
import { ResponsiveFindings } from "@/components/ResponsiveFindings";
import { CATEGORY_LABEL } from "@/components/Badges";

const CATEGORY_TABS: (IssueCategory | "all")[] = [
  "all",
  "content",
  "extra-text",
  "colors",
  "images",
  "icons",
  "links",
  "buttons",
  "forms",
];

const CATEGORY_SCORE_ROWS: { label: string; key: keyof AnalysisResult["categoryScores"] }[] = [
  { label: "Content", key: "content" },
  { label: "Extra Text", key: "extraText" },
  { label: "Colors", key: "colors" },
  { label: "Images", key: "images" },
  { label: "Icons", key: "icons" },
  { label: "Links", key: "links" },
  { label: "Buttons", key: "buttons" },
  { label: "Forms", key: "forms" },
];

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<AnalysisResult | null | undefined>(undefined);
  const [tab, setTab] = useState<"overview" | "responsive">("overview");
  const [categoryFilter, setCategoryFilter] = useState<IssueCategory | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [statusFilter, setStatusFilter] = useState<IssueStatus | "all">("all");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    loadAnalysis(params.id).then(setAnalysis);
  }, [params.id]);

  const filteredIssues = useMemo(() => {
    if (!analysis) return [];
    return analysis.issues.filter((issue) => {
      if (categoryFilter !== "all" && issue.category !== categoryFilter) return false;
      if (severityFilter !== "all" && issue.severity !== severityFilter) return false;
      if (statusFilter !== "all" && issue.status !== statusFilter) return false;
      return true;
    });
  }, [analysis, categoryFilter, severityFilter, statusFilter]);

  function updateIssue(updated: Issue) {
    setAnalysis((prev) => {
      if (!prev) return prev;
      const next: AnalysisResult = { ...prev, issues: prev.issues.map((i) => (i.id === updated.id ? updated : i)) };
      void saveAnalysis(next);
      return next;
    });
  }

  if (analysis === undefined) {
    return <main className="mx-auto max-w-content px-6 py-14 text-center text-sm text-ink-muted">Loading…</main>;
  }

  if (analysis === null) {
    return (
      <main className="mx-auto max-w-content px-6 py-20 text-center">
        <h1 className="font-display text-xl font-bold text-ink">Analysis not found</h1>
        <p className="mt-2 text-sm text-ink-muted">
          This result isn&apos;t in your browser&apos;s storage — it may have been on a different device, or your browser data was
          cleared.
        </p>
        <Link href="/" className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">
          Start a new analysis
        </Link>
      </main>
    );
  }

  const selectedIssue = selectedIssueId ? analysis.issues.find((i) => i.id === selectedIssueId) ?? null : null;
  const counts = {
    high: analysis.issues.filter((i) => i.severity === "high").length,
    medium: analysis.issues.filter((i) => i.severity === "medium").length,
    low: analysis.issues.filter((i) => i.severity === "low").length,
  };

  return (
    <main className="mx-auto max-w-content px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-bold text-ink">Analysis Results</h1>
            {analysis.isDemo && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                <Sparkles size={11} /> Demo Mode
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-ink-muted">
            {analysis.figmaUrl} <span className="mx-1">→</span> {analysis.websiteUrl}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Viewport {analysis.viewport.label} · Analyzed {new Date(analysis.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href={`/report/${analysis.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-sunken"
          >
            <FileText size={15} /> Developer Report
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <RefreshCcw size={15} /> New Analysis
          </Link>
        </div>
      </div>

      {analysis.warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {analysis.warnings.map((w, i) => (
            <div key={i} className="rounded-xl border border-severity-medium/30 bg-severity-medium-bg px-3.5 py-2.5 text-sm text-severity-medium">
              {w}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[auto_1fr]">
        <div className="flex items-center justify-center rounded-2xl border border-border bg-white p-6 shadow-panel">
          <div className="text-center">
            <ScoreGauge score={analysis.overallScore} size={140} />
            <p className="mt-3 text-sm font-semibold text-ink">Overall Match Score</p>
            <p className="mt-1 text-xs text-ink-muted">
              {counts.high} high · {counts.medium} medium · {counts.low} low
            </p>
          </div>
        </div>
        <div className="grid gap-5 rounded-2xl border border-border bg-white p-6 shadow-panel sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORY_SCORE_ROWS.map((row) => (
            <CategoryBar key={row.key} label={row.label} score={analysis.categoryScores[row.key]} />
          ))}
        </div>
      </div>

      <div className="mt-8 flex gap-1 border-b border-border">
        {(["overview", "responsive"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
              tab === t ? "border-violet-600 text-violet-700" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t === "overview" ? "Overview & Issues" : "Responsive Checking"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="mt-6 space-y-8">
          <section className="rounded-2xl border border-border bg-white p-6 shadow-panel">
            <h2 className="font-display text-base font-semibold text-ink">Visual Comparison</h2>
            <p className="mt-1 text-sm text-ink-muted">Click any highlighted box to jump to that issue.</p>
            <div className="mt-4">
              <ScreenshotCompare
                figmaSrc={analysis.figma.thumbnailUrl}
                websiteSrc={analysis.website.screenshotDataUrl}
                issues={analysis.issues}
                activeIssueId={selectedIssueId}
                onSelectIssue={setSelectedIssueId}
              />
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-ink">
                Detected Issues <span className="text-ink-muted">({filteredIssues.length})</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as Severity | "all")}
                  className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-ink-soft outline-none focus:border-violet-400"
                >
                  <option value="all">All priorities</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as IssueStatus | "all")}
                  className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-ink-soft outline-none focus:border-violet-400"
                >
                  <option value="all">All statuses</option>
                  <option value="open">Open</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="fixed">Fixed</option>
                </select>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {CATEGORY_TABS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    categoryFilter === c ? "bg-violet-600 text-white" : "bg-surface-sunken text-ink-soft hover:bg-violet-50"
                  }`}
                >
                  {c === "all" ? "All" : CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              {filteredIssues.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-surface-sunken p-8 text-center text-sm text-ink-muted">
                  No issues match these filters.
                </div>
              ) : (
                filteredIssues
                  .sort((a, b) => a.number - b.number)
                  .map((issue) => <IssueCard key={issue.id} issue={issue} onOpen={() => setSelectedIssueId(issue.id)} />)
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="mt-6">
          <ResponsiveFindings findings={analysis.responsive} />
        </div>
      )}

      {selectedIssue && (
        <IssueDetailPanel analysis={analysis} issue={selectedIssue} onClose={() => setSelectedIssueId(null)} onUpdate={updateIssue} />
      )}
    </main>
  );
}
