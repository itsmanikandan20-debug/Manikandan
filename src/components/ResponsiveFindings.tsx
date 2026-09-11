import type { ResponsiveFinding, Severity } from "@/lib/types";
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  overflow: "Overflow",
  overlap: "Overlapping elements",
  "text-cutoff": "Text cut off",
  "button-unusable": "Button too small",
  "image-broken": "Broken image",
  "nav-broken": "Navigation broken",
  "layout-unusable": "Layout unusable",
};

const SEVERITY_ICON: Record<Severity, typeof AlertTriangle> = {
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
};

export function ResponsiveFindings({ findings }: { findings: ResponsiveFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-sunken p-8 text-center text-sm text-ink-muted">
        Responsive checking wasn&apos;t run for this analysis. Re-run analysis with &quot;Also run responsive checks&quot; enabled to test
        the other 5 viewport sizes for overflow, overlap, cut-off text, and broken navigation.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">
        Separate from the exact Figma-vs-website comparison — this checks whether the live site itself holds up across common screen
        sizes.
      </p>
      {findings.map((finding) => (
        <div key={finding.viewport.label} className="overflow-hidden rounded-2xl border border-border bg-white shadow-panel">
          <div className="flex items-center justify-between border-b border-border bg-surface-sunken px-4 py-3">
            <p className="text-sm font-semibold text-ink">{finding.viewport.label}</p>
            {finding.issues.length === 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-approved">
                <CheckCircle2 size={14} /> No issues found
              </span>
            ) : (
              <span className="text-xs font-semibold text-severity-high">{finding.issues.length} issue{finding.issues.length === 1 ? "" : "s"}</span>
            )}
          </div>

          <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,320px)_1fr]">
            {finding.screenshotDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={finding.screenshotDataUrl} alt={`${finding.viewport.label} screenshot`} className="max-h-96 w-full rounded-lg border border-border object-cover object-top" />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-xs text-ink-muted">
                No screenshot
              </div>
            )}

            <div className="space-y-2">
              {finding.issues.length === 0 && <p className="text-sm text-ink-muted">The layout held up well at this size.</p>}
              {finding.issues.map((issue, i) => {
                const Icon = SEVERITY_ICON[issue.severity];
                return (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg bg-surface-sunken px-3 py-2.5">
                    <Icon size={16} className={`mt-0.5 shrink-0 ${issue.severity === "high" ? "text-severity-high" : issue.severity === "medium" ? "text-severity-medium" : "text-severity-low"}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink">{TYPE_LABEL[issue.type] ?? issue.type}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{issue.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
