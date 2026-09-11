import type { Issue } from "@/lib/types";
import { SeverityBadge, StatusBadge, CategoryBadge, ConfidenceBadge } from "@/components/Badges";
import { ChevronRight } from "lucide-react";

export function IssueCard({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-start justify-between gap-4 rounded-xl border border-border bg-white p-4 text-left shadow-sm transition hover:border-violet-200 hover:shadow-panel"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-muted">#{issue.number}</span>
          <SeverityBadge severity={issue.severity} />
          <CategoryBadge category={issue.category} />
          <StatusBadge status={issue.status} />
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-ink">{issue.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">{issue.section} · {issue.description}</p>
        <div className="mt-1.5">
          <ConfidenceBadge confidence={issue.matchConfidence} />
        </div>
      </div>
      <ChevronRight size={18} className="mt-1 shrink-0 text-ink-muted" />
    </button>
  );
}
