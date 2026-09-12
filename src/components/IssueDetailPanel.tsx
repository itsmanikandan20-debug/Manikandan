"use client";

import { useState } from "react";
import { X, ExternalLink, MousePointerClick } from "lucide-react";
import type { AnalysisResult, Issue, IssueStatus, Severity } from "@/lib/types";
import { SeverityBadge, StatusBadge, CategoryBadge, ConfidenceBadge } from "@/components/Badges";
import { ScreenshotCompare } from "@/components/ScreenshotCompare";
import { buildHighlightBookmarklet } from "@/lib/bookmarklet";

const STATUS_OPTIONS: IssueStatus[] = ["open", "approved", "rejected", "fixed"];
const SEVERITY_OPTIONS: Severity[] = ["high", "medium", "low"];

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink">{value}</p>
    </div>
  );
}

export function IssueDetailPanel({
  analysis,
  issue,
  onClose,
  onUpdate,
}: {
  analysis: AnalysisResult;
  issue: Issue;
  onClose: () => void;
  onUpdate: (issue: Issue) => void;
}) {
  const [comment, setComment] = useState(issue.designerComment ?? "");
  const [editingCorrection, setEditingCorrection] = useState(false);
  const [correction, setCorrection] = useState(issue.correction);

  const update = (partial: Partial<Issue>) => onUpdate({ ...issue, ...partial });

  const openOnWebsite = () => {
    if (analysis.isDemo) {
      window.open(`/demo-site?analysisId=${analysis.id}&issueId=${issue.id}`, "_blank");
      return;
    }
    window.open(analysis.website.url, "_blank");
  };

  const bookmarklet = issue.websiteSelector
    ? buildHighlightBookmarklet(issue.websiteSelector, issue.number, issue.title)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-white px-6 py-4">
          <div>
            <p className="text-xs font-semibold text-ink-muted">Issue #{issue.number}</p>
            <h2 className="mt-0.5 font-display text-lg font-bold text-ink">{issue.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SeverityBadge severity={issue.severity} />
              <CategoryBadge category={issue.category} />
              <StatusBadge status={issue.status} />
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-ink-muted hover:bg-surface-sunken">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-6 px-6 py-6">
          <div>
            <p className="text-sm text-ink-soft">{issue.description}</p>
            <div className="mt-1">
              <ConfidenceBadge confidence={issue.matchConfidence} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Visual comparison</p>
            <ScreenshotCompare
              figmaSrc={analysis.figma.thumbnailUrl}
              figmaWidth={analysis.figma.frameWidth}
              figmaHeight={analysis.figma.frameHeight}
              websiteSrc={analysis.website.screenshotDataUrl}
              issues={[issue]}
              activeIssueId={issue.id}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Figma (Expected)" value={issue.expected} />
            <Field label="Website (Actual)" value={issue.actual} />
          </div>
          <Field label="Difference" value={issue.difference} />

          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Correction</p>
              <button
                onClick={() => setEditingCorrection((v) => !v)}
                className="text-xs font-medium text-violet-600 hover:text-violet-700"
              >
                {editingCorrection ? "Done" : "Edit"}
              </button>
            </div>
            {editingCorrection ? (
              <textarea
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                onBlur={() => update({ correction })}
                rows={3}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
            ) : (
              <p className="mt-1 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink">{correction}</p>
            )}
          </div>

          {issue.aiExplanation && (
            <div className="rounded-lg border border-violet-100 bg-violet-50 px-3.5 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Why this matters (AI)</p>
              <p className="mt-1 text-sm text-violet-900">{issue.aiExplanation}</p>
            </div>
          )}

          <div className="rounded-xl border border-border p-4">
            <p className="text-sm font-semibold text-ink">Developer navigation</p>
            <p className="mt-1 text-xs text-ink-muted">
              {analysis.isDemo
                ? "Opens a mock live page and highlights this element — a stand-in for the real site since this is Demo Mode."
                : "Opens the real live website. Drag the highlight bookmarklet to your bookmarks bar once, then click it on the live tab to outline this exact element."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={openOnWebsite}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink/90"
              >
                <ExternalLink size={14} /> Open on Website
              </button>
              {bookmarklet && (
                <a
                  href={bookmarklet}
                  onClick={(e) => e.preventDefault()}
                  draggable
                  className="inline-flex cursor-grab items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3.5 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                  title="Drag this to your bookmarks bar"
                >
                  <MousePointerClick size={14} /> Highlight Element (drag me)
                </a>
              )}
            </div>
            {issue.websiteSelector && (
              <p className="mt-2 truncate text-xs text-ink-muted">
                Selector: <code className="rounded bg-surface-sunken px-1 py-0.5">{issue.websiteSelector}</code>
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border p-4">
            <p className="text-sm font-semibold text-ink">Designer review</p>

            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-ink-muted">Status</p>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => update({ status: s })}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                      issue.status === s ? "border-violet-500 bg-violet-600 text-white" : "border-border text-ink-soft hover:bg-surface-sunken"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => update({ status: "approved" })}
                className="rounded-lg bg-status-approved-bg px-3.5 py-2 text-xs font-semibold text-status-approved hover:opacity-80"
              >
                Approve issue
              </button>
              <button
                onClick={() => update({ status: "rejected" })}
                className="rounded-lg bg-status-rejected-bg px-3.5 py-2 text-xs font-semibold text-status-rejected hover:opacity-80"
              >
                Reject issue
              </button>
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-xs font-medium text-ink-muted">Priority</p>
              <div className="flex gap-2">
                {SEVERITY_OPTIONS.map((sev) => (
                  <button
                    key={sev}
                    onClick={() => update({ severity: sev })}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                      issue.severity === sev ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border text-ink-soft hover:bg-surface-sunken"
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-xs font-medium text-ink-muted">Designer comment</p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onBlur={() => update({ designerComment: comment })}
                placeholder="Add a note for the developer…"
                rows={3}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
