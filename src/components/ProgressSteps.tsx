import { Check, Loader2 } from "lucide-react";

export interface ProgressStep {
  label: string;
  status: "pending" | "active" | "done" | "error";
}

export function ProgressSteps({ steps }: { steps: ProgressStep[] }) {
  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-3">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              step.status === "done"
                ? "bg-status-approved-bg text-status-approved"
                : step.status === "active"
                  ? "bg-violet-100 text-violet-700"
                  : step.status === "error"
                    ? "bg-severity-high-bg text-severity-high"
                    : "bg-surface-sunken text-ink-muted"
            }`}
          >
            {step.status === "done" ? (
              <Check size={14} strokeWidth={3} />
            ) : step.status === "active" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              i + 1
            )}
          </div>
          <span
            className={`text-sm ${
              step.status === "active" ? "font-medium text-ink" : step.status === "pending" ? "text-ink-muted" : "text-ink"
            }`}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
