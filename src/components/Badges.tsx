import type { IssueCategory, IssueStatus, Severity } from "@/lib/types";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";

const SEVERITY_STYLE: Record<Severity, { bg: string; text: string; icon: typeof AlertTriangle }> = {
  high: { bg: "bg-severity-high-bg", text: "text-severity-high", icon: AlertTriangle },
  medium: { bg: "bg-severity-medium-bg", text: "text-severity-medium", icon: AlertCircle },
  low: { bg: "bg-severity-low-bg", text: "text-severity-low", icon: Info },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${s.bg} ${s.text}`}>
      <Icon size={12} strokeWidth={2.5} />
      {severity.toUpperCase()}
    </span>
  );
}

const STATUS_STYLE: Record<IssueStatus, { bg: string; text: string; label: string }> = {
  open: { bg: "bg-status-open-bg", text: "text-status-open", label: "Open" },
  approved: { bg: "bg-status-approved-bg", text: "text-status-approved", label: "Approved" },
  rejected: { bg: "bg-status-rejected-bg", text: "text-status-rejected", label: "Rejected" },
  fixed: { bg: "bg-status-fixed-bg", text: "text-status-fixed", label: "Fixed" },
};

export function StatusBadge({ status }: { status: IssueStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

const CATEGORY_LABEL: Record<IssueCategory, string> = {
  visual: "Visual",
  content: "Content",
  layout: "Layout",
  ux: "UX",
};

export function CategoryBadge({ category }: { category: IssueCategory }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium text-ink-soft">
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) {
    return <span className="text-xs text-ink-muted">No direct match</span>;
  }
  const color = confidence >= 70 ? "text-status-approved" : confidence >= 45 ? "text-severity-medium" : "text-severity-high";
  return <span className={`text-xs font-medium ${color}`}>Match confidence: {confidence}%</span>;
}
