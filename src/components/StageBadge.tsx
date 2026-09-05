import type { IdentificationStage } from "@/lib/types";
import { getStageLabel } from "@/lib/stage";

const stageStyles: Record<IdentificationStage, string> = {
  similar_image_found: "bg-blue-50 text-signal-match border-blue-100",
  source_identified: "bg-violet-50 text-signal-identified border-violet-100",
  live_verified: "bg-emerald-50 text-signal-verified border-emerald-100",
  source_not_found: "bg-red-50 text-signal-notfound border-red-100",
};

const stageDot: Record<IdentificationStage, string> = {
  similar_image_found: "bg-signal-match",
  source_identified: "bg-signal-identified",
  live_verified: "bg-signal-verified",
  source_not_found: "bg-signal-notfound",
};

export function StageBadge({ stage }: { stage: IdentificationStage }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${stageStyles[stage]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${stageDot[stage]}`} />
      {getStageLabel(stage)}
    </span>
  );
}
