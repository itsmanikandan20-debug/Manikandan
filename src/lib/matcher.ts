import type { DesignElement, ElementType, MatchedPair } from "./types";
import { textSimilarity, positionDistance, sizeSimilarity, clamp01, round, normalizeText } from "./similarity";

// Element types that are compared 1:1 against each other during matching.
// Pure layout containers (frame/section) are matched separately by the
// comparison engine when it checks spacing/gap, not through this pool.
const MATCHABLE_TYPES: ElementType[] = [
  "heading",
  "paragraph",
  "text",
  "button",
  "image",
  "icon",
  "input",
  "link",
  "component",
];

// Types that are allowed to match each other even though they're not
// identical — e.g. a Figma "text" layer that became an <h2> in code.
const COMPATIBLE_TYPES: Record<string, ElementType[]> = {
  heading: ["heading", "text"],
  paragraph: ["paragraph", "text"],
  text: ["text", "heading", "paragraph"],
  button: ["button", "link", "component"],
  link: ["link", "button"],
  image: ["image", "icon"],
  icon: ["icon", "image"],
  input: ["input"],
  component: ["component", "button"],
};

function typeScore(a: ElementType, b: ElementType): number {
  if (a === b) return 1;
  const compatible = COMPATIBLE_TYPES[a] ?? [a];
  return compatible.includes(b) ? 0.55 : 0;
}

export const MIN_MATCH_CONFIDENCE = 38;

/**
 * Matches Figma elements to website elements using a weighted blend of
 * element type, text similarity, position, and size — then greedily
 * assigns the highest-confidence pairs first (one-to-one).
 *
 * This is a heuristic, not ground truth: every result carries a
 * `confidence` score so the UI can be honest about uncertainty instead of
 * pretending the match is exact.
 */
export function matchElements(
  figmaElements: DesignElement[],
  websiteElements: DesignElement[],
  frameWidth: number
): MatchedPair[] {
  const figmaPool = figmaElements.filter((el) => MATCHABLE_TYPES.includes(el.type));
  const websitePool = websiteElements.filter((el) => MATCHABLE_TYPES.includes(el.type));
  const scale = Math.max(frameWidth, 800);

  type Candidate = { figmaId: string; websiteId: string; score: number };
  const candidates: Candidate[] = [];

  for (const f of figmaPool) {
    for (const w of websitePool) {
      const tScore = typeScore(f.type, w.type);
      if (tScore === 0) continue;

      const szScore = sizeSimilarity(f, w);
      // A hero illustration and a small icon can both be type "image", but
      // if one is a tiny fraction of the other's area they are not the
      // same element rendered at a slightly different size — they're two
      // different things. Refuse the candidate outright rather than let
      // text/position coincidentally push it over the match threshold.
      if (szScore < 0.15) continue;

      const txtScore = f.text || w.text ? textSimilarity(f.text, w.text) : 0.5;
      const posScore = 1 - positionDistance(f, w, scale);
      const sectionScore = normalizeText(f.section) === normalizeText(w.section) ? 1 : 0;

      const combined =
        tScore * 0.3 + txtScore * 0.3 + posScore * 0.18 + szScore * 0.1 + sectionScore * 0.12;
      candidates.push({ figmaId: f.id, websiteId: w.id, score: combined });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedFigma = new Set<string>();
  const usedWebsite = new Set<string>();
  const pairs: MatchedPair[] = [];

  for (const c of candidates) {
    if (usedFigma.has(c.figmaId) || usedWebsite.has(c.websiteId)) continue;
    const confidence = round(clamp01(c.score) * 100);
    if (confidence < MIN_MATCH_CONFIDENCE) continue;
    usedFigma.add(c.figmaId);
    usedWebsite.add(c.websiteId);
    pairs.push({ figmaId: c.figmaId, websiteId: c.websiteId, confidence });
  }

  for (const f of figmaPool) {
    if (!usedFigma.has(f.id)) pairs.push({ figmaId: f.id, websiteId: null, confidence: 0 });
  }
  for (const w of websitePool) {
    if (!usedWebsite.has(w.id)) pairs.push({ figmaId: null, websiteId: w.id, confidence: 0 });
  }

  return pairs;
}
