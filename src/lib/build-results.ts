import type { IdentificationStage, MatchResult } from "./types";
import type { RawVisualMatch } from "./reverse-image-search";
import { checkLive } from "./live-check";

const FALLBACK_THUMBNAIL = "/no-preview.svg";

// Google Lens doesn't return a numeric similarity score, only a relevance
// order — so scores here are an approximate ranking, not a measurement.
// The UI copy on /results says this explicitly rather than implying precision.
function scoreForRank(index: number): number {
  return Math.max(45, 90 - index * 7);
}

function stageFor(link: string | null, isLive: boolean): IdentificationStage {
  if (!link) return "similar_image_found";
  return isLive ? "live_verified" : "source_identified";
}

export async function buildMatchResults(rawMatches: RawVisualMatch[]): Promise<MatchResult[]> {
  return Promise.all(
    rawMatches.map(async (match, index) => {
      const isLive = match.link ? await checkLive(match.link) : false;
      const stage = stageFor(match.link, isLive);

      const result: MatchResult = {
        id: `match-${Date.now()}-${index}`,
        websiteName: match.source ?? match.title,
        screenshotUrl: match.thumbnail ?? FALLBACK_THUMBNAIL,
        liveUrl: match.link,
        stage,
        similarityScore: scoreForRank(index),
        // Per-attribute scoring would need a separate vision call per
        // candidate site — out of scope for this MVP to control cost.
        matchedAttributes: [],
        matchedOn: ["Overall visual style"],
        lastCheckedAt: new Date().toISOString(),
      };
      return result;
    })
  );
}
