import type { IdentificationStage } from "./types";

export function getStageLabel(stage: IdentificationStage): string {
  switch (stage) {
    case "similar_image_found":
      return "Similar image found";
    case "source_identified":
      return "Source identified";
    case "live_verified":
      return "Live website verified";
    case "source_not_found":
      return "Source website not found";
  }
}
