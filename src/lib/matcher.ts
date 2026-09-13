import type { DesignElement, ElementType, MatchedPair } from "./types";
import { textSimilarity, positionDistance, sizeSimilarity, clamp01, round, normalizeText } from "./similarity";

// Element types that are compared 1:1 against each other during matching.
// Pure layout containers (frame/section) are matched separately, at the
// section level, below.
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
  // A Figma export has no reliable way to tell a nav-menu link apart from
  // any other short text layer unless the layer is explicitly named for
  // it — so "text" needs to be able to match a website's real <a> link,
  // or every nav link comparison fails outright (Figma "text" vs website
  // "link" would otherwise never be compatible).
  text: ["text", "heading", "paragraph", "link"],
  button: ["button", "link", "component"],
  link: ["link", "button", "text"],
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

// ---- Phase 1: section matching ---------------------------------------------
//
// Matching every element against every other element using one page-wide
// absolute Y position (the old approach) breaks the moment one side has a
// section the other doesn't: everything below that point is offset, so
// position — a real, weighted signal — starts actively misleading the
// matcher into comparing unrelated elements. A missing announcement bar
// shouldn't cascade into the nav, hero, and every section after it looking
// "wrong".
//
// The fix is to match sections first (by name, by their own text/heading
// content, by what kinds of elements they contain, and by their order on
// the page), and only match individual elements *within* a matched pair of
// sections — using position measured relative to that section's own top,
// not the whole page. A section with no match on the other side is
// reported once, as a missing/extra section, instead of enumerating every
// element inside it as its own separate mismatch.

interface SectionSummary {
  name: string;
  order: number; // 0-based top-to-bottom index among this side's sections
  elements: DesignElement[];
  typeHistogram: Map<ElementType, number>;
  representativeText: string;
}

function summarizeSections(elements: DesignElement[]): SectionSummary[] {
  const groups = new Map<string, DesignElement[]>();
  for (const el of elements) {
    const key = el.section || "Page";
    const list = groups.get(key);
    if (list) list.push(el);
    else groups.set(key, [el]);
  }

  const summaries = Array.from(groups.entries()).map(([name, els]) => {
    const typeHistogram = new Map<ElementType, number>();
    for (const el of els) typeHistogram.set(el.type, (typeHistogram.get(el.type) ?? 0) + 1);

    // Prefer headings for the section's "identity" text, then other
    // copy — this is what lets e.g. a Figma "Hero" section match a
    // website section named differently but headlined "Driving Outcomes"
    // on both sides.
    const textish = els
      .filter((e) => e.text && ["heading", "paragraph", "button", "text"].includes(e.type))
      .sort((a, b) => (a.type === "heading" ? -1 : 0) - (b.type === "heading" ? -1 : 0));
    const representativeText = textish
      .slice(0, 3)
      .map((e) => e.text)
      .join(" ");

    const topY = Math.min(...els.map((e) => e.y));
    return { name, topY, elements: els, typeHistogram, representativeText };
  });

  summaries.sort((a, b) => a.topY - b.topY);
  return summaries.map((s, i) => ({ ...s, order: i }));
}

function histogramSimilarity(a: Map<ElementType, number>, b: Map<ElementType, number>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const va = a.get(k) ?? 0;
    const vb = b.get(k) ?? 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na === 0 || nb === 0) return 0;
  return clamp01(dot / (Math.sqrt(na) * Math.sqrt(nb)));
}

const MIN_SECTION_MATCH_SCORE = 0.32;

function matchSections(
  figmaSections: SectionSummary[],
  websiteSections: SectionSummary[]
): { pairs: { f: SectionSummary; w: SectionSummary }[]; unmatchedFigma: SectionSummary[]; unmatchedWebsite: SectionSummary[] } {
  type Candidate = { f: SectionSummary; w: SectionSummary; score: number };
  const candidates: Candidate[] = [];
  const figmaCount = Math.max(1, figmaSections.length - 1);
  const websiteCount = Math.max(1, websiteSections.length - 1);

  for (const f of figmaSections) {
    for (const w of websiteSections) {
      const nameScore = textSimilarity(f.name, w.name);
      const textScore = f.representativeText || w.representativeText ? textSimilarity(f.representativeText, w.representativeText) : 0.5;
      const compositionScore = histogramSimilarity(f.typeHistogram, w.typeHistogram);
      const orderScore = 1 - Math.abs(f.order / figmaCount - w.order / websiteCount);

      const score = nameScore * 0.4 + textScore * 0.3 + compositionScore * 0.15 + orderScore * 0.15;
      candidates.push({ f, w, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedFigma = new Set<string>();
  const usedWebsite = new Set<string>();
  const pairs: { f: SectionSummary; w: SectionSummary }[] = [];

  for (const c of candidates) {
    if (usedFigma.has(c.f.name) || usedWebsite.has(c.w.name)) continue;
    if (c.score < MIN_SECTION_MATCH_SCORE) continue;
    usedFigma.add(c.f.name);
    usedWebsite.add(c.w.name);
    pairs.push({ f: c.f, w: c.w });
  }

  const unmatchedFigma = figmaSections.filter((s) => !usedFigma.has(s.name));
  const unmatchedWebsite = websiteSections.filter((s) => !usedWebsite.has(s.name));

  return { pairs, unmatchedFigma, unmatchedWebsite };
}

// ---- Phase 2: element matching within a matched section pair --------------

// A Figma export very often represents one visual control as two separate
// layers — a background shape (the button/chip/badge fill) and a text
// label sitting on top of it — while the live DOM collapses that into one
// element (one <button>). Left alone, this makes the shape-only layer look
// like a spurious "missing" element and the label-only layer's real match
// look "missing" too, purely because neither one alone has everything the
// single website element has. Detecting same-type, heavily-overlapping
// sibling layers and merging them into one representative element (fill
// from whichever has one, text from whichever has one, union bounding box)
// fixes this at the source — geometrically, with no reliance on layer
// naming conventions.
const CONSOLIDATABLE_TYPES: ElementType[] = ["button", "icon", "image", "input", "link"];
const OVERLAP_MERGE_THRESHOLD = 0.6;

function boxOverlapRatio(a: DesignElement, b: DesignElement): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const overlapArea = (x2 - x1) * (y2 - y1);
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 ? overlapArea / minArea : 0;
}

function consolidateOverlappingLayers(elements: DesignElement[]): DesignElement[] {
  const pool = elements.filter((e) => CONSOLIDATABLE_TYPES.includes(e.type));
  const rest = elements.filter((e) => !CONSOLIDATABLE_TYPES.includes(e.type));
  const used = new Set<string>();
  const out: DesignElement[] = [];

  for (let i = 0; i < pool.length; i++) {
    if (used.has(pool[i].id)) continue;
    let merged = pool[i];
    for (let j = i + 1; j < pool.length; j++) {
      if (used.has(pool[j].id)) continue;
      if (pool[j].type !== merged.type) continue; // only merge same-type siblings (button+button, icon+icon, ...)
      if (boxOverlapRatio(merged, pool[j]) < OVERLAP_MERGE_THRESHOLD) continue;

      const withText = merged.text ? merged : pool[j].text ? pool[j] : merged;
      const withFill = merged.backgroundColor || merged.gradientStops ? merged : pool[j].backgroundColor || pool[j].gradientStops ? pool[j] : merged;
      const x = Math.min(merged.x, pool[j].x);
      const y = Math.min(merged.y, pool[j].y);
      const right = Math.max(merged.x + merged.width, pool[j].x + pool[j].width);
      const bottom = Math.max(merged.y + merged.height, pool[j].y + pool[j].height);

      merged = {
        ...withText,
        backgroundColor: withFill.backgroundColor,
        gradientStops: withFill.gradientStops,
        borderRadius: withFill.borderRadius ?? withText.borderRadius,
        borderColor: withFill.borderColor ?? withText.borderColor,
        borderWidth: withFill.borderWidth ?? withText.borderWidth,
        x,
        y,
        width: right - x,
        height: bottom - y,
      };
      used.add(pool[j].id);
    }
    used.add(pool[i].id);
    out.push(merged);
  }

  return [...out, ...rest];
}

function matchElementsWithinSection(figmaElsRaw: DesignElement[], websiteElsRaw: DesignElement[], scale: number): MatchedPair[] {
  const figmaEls = consolidateOverlappingLayers(figmaElsRaw);
  const websiteEls = consolidateOverlappingLayers(websiteElsRaw);
  const figmaPool = figmaEls.filter((el) => MATCHABLE_TYPES.includes(el.type));
  const websitePool = websiteEls.filter((el) => MATCHABLE_TYPES.includes(el.type));
  if (figmaPool.length === 0 && websitePool.length === 0) return [];

  // Position is measured relative to this section's own top-left, not the
  // whole page — so a section's internal layout can be compared fairly
  // regardless of where that section happens to sit on either page.
  const fTop = figmaPool.length ? Math.min(...figmaPool.map((e) => e.y)) : 0;
  const fLeft = figmaPool.length ? Math.min(...figmaPool.map((e) => e.x)) : 0;
  const wTop = websitePool.length ? Math.min(...websitePool.map((e) => e.y)) : 0;
  const wLeft = websitePool.length ? Math.min(...websitePool.map((e) => e.x)) : 0;
  const relative = (el: DesignElement, top: number, left: number) => ({ ...el, x: el.x - left, y: el.y - top });

  const usedFigma = new Set<string>();
  const usedWebsite = new Set<string>();
  const pairs: MatchedPair[] = [];

  // Exact text wins regardless of type or size, before any fuzzy scoring
  // happens — real pages have all sorts of structural quirks (an inline
  // link wrapping different text than expected, a wrapper element with a
  // slightly odd classified type, a stray tracking element) that can throw
  // off type/size-based scoring even when two elements plainly say the
  // same thing. Identical text within the same section is about as strong
  // a signal as exists that two elements are the same one.
  const EXACT_TEXT_MIN_LENGTH = 3; // skip near-empty strings, too easy to collide by coincidence
  for (const fRaw of figmaPool) {
    if (usedFigma.has(fRaw.id)) continue;
    const nf = normalizeText(fRaw.text);
    if (nf.length < EXACT_TEXT_MIN_LENGTH) continue;
    const match = websitePool.find((w) => !usedWebsite.has(w.id) && normalizeText(w.text) === nf);
    if (!match) continue;
    usedFigma.add(fRaw.id);
    usedWebsite.add(match.id);
    pairs.push({ figmaId: fRaw.id, websiteId: match.id, confidence: 95 });
  }

  type Candidate = { figmaId: string; websiteId: string; score: number };
  const candidates: Candidate[] = [];

  for (const fRaw of figmaPool) {
    if (usedFigma.has(fRaw.id)) continue;
    const f = relative(fRaw, fTop, fLeft);
    for (const wRaw of websitePool) {
      if (usedWebsite.has(wRaw.id)) continue;
      const w = relative(wRaw, wTop, wLeft);
      const tScore = typeScore(fRaw.type, wRaw.type);
      if (tScore === 0) continue;

      const szScore = sizeSimilarity(fRaw, wRaw);
      // A hero illustration and a small icon can both be type "image", but
      // if one is a tiny fraction of the other's area they are not the
      // same element rendered at a slightly different size — they're two
      // different things. Refuse the candidate outright rather than let
      // text/position coincidentally push it over the match threshold.
      //
      // This floor does NOT apply to text-ish types (heading/paragraph/
      // text/link): an SVG <text> element's bounding box hugs its glyphs
      // tightly, while the equivalent live heading is typically a
      // block-level element stretched to its container's width — the
      // exact same word "CRM" can be a 40×18 box in one and a 360×21 box
      // in the other. Rejecting on size alone threw away obviously-correct
      // matches (identical text) before text similarity ever got a say.
      const isTextish = (t: ElementType) => t === "heading" || t === "paragraph" || t === "text" || t === "link";
      if (!isTextish(fRaw.type) && !isTextish(wRaw.type) && szScore < 0.15) continue;

      const txtScore = fRaw.text || wRaw.text ? textSimilarity(fRaw.text, wRaw.text) : 0.5;
      const posScore = 1 - positionDistance(f, w, scale);

      const combined = tScore * 0.35 + txtScore * 0.35 + posScore * 0.2 + szScore * 0.1;
      candidates.push({ figmaId: fRaw.id, websiteId: wRaw.id, score: combined });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

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

export interface SectionDiff {
  name: string;
  elements: DesignElement[];
}

export interface MatchResult {
  pairs: MatchedPair[];
  // A whole section present on one side with nothing corresponding on the
  // other — reported once (e.g. "Announcement bar missing"), instead of
  // flagging every element inside it as a separate mismatch.
  missingSections: SectionDiff[];
  extraSections: SectionDiff[];
}

/**
 * Matches a Figma design to a live website in two passes: first sections
 * (by name, headline text, element composition, and page order), then —
 * only within each matched pair of sections — individual elements, using a
 * weighted blend of type, text similarity, position, and size. A section
 * with nothing to match on the other side is reported as missing/extra
 * once, rather than letting every element inside it be compared against
 * unrelated content further down the page.
 *
 * This is a heuristic, not ground truth: every element match carries a
 * `confidence` score so the UI can be honest about uncertainty instead of
 * pretending the match is exact.
 */
export function matchElements(figmaElements: DesignElement[], websiteElements: DesignElement[], frameWidth: number): MatchResult {
  const scale = Math.max(frameWidth, 800);
  const figmaSections = summarizeSections(figmaElements);
  const websiteSections = summarizeSections(websiteElements);

  let pairs: MatchedPair[];
  let unmatchedFigmaSections: SectionSummary[] = [];
  let unmatchedWebsiteSections: SectionSummary[] = [];

  // Section-first matching needs real section structure on BOTH sides to
  // mean anything. If one side has no identifiable sections at all (a flat
  // SVG export with no named groups, or a website with no semantic
  // landmarks — <header>/<nav>/<main>/<footer>/<section> or ARIA
  // banner/contentinfo roles), grouping would either be a no-op or, worse,
  // force everything into one bucket and wrongly report every other
  // section as "missing". Fall back to matching the whole page as a single
  // pool in that case, same as before this feature existed.
  if (figmaSections.length <= 1 || websiteSections.length <= 1) {
    pairs = matchElementsWithinSection(figmaElements, websiteElements, scale);
  } else {
    const { pairs: sectionPairs, unmatchedFigma, unmatchedWebsite } = matchSections(figmaSections, websiteSections);
    pairs = [];
    for (const { f, w } of sectionPairs) {
      pairs.push(...matchElementsWithinSection(f.elements, w.elements, scale));
    }
    unmatchedFigmaSections = unmatchedFigma;
    unmatchedWebsiteSections = unmatchedWebsite;
  }

  // Global exact-text rescue: the in-section rescue above only catches an
  // identical-text pair when section-matching already put both elements in
  // the same pool. It can't help when the mismatch is at the section level
  // itself — an entire section failed to pair up, or an element inside a
  // correctly-matched section still lost its individual pairing to
  // whatever real-page structural quirk (a wrapper element, an unusual
  // classified type) defeated the section-scoped scoring. This pass looks
  // across EVERY currently-unmatched element on both sides, regardless of
  // which section (or no section) it ended up in, and force-pairs any
  // exact text match it finds — the same rationale as the in-section
  // version, just without the section boundary limiting what it can see.
  const figmaById = new Map(figmaElements.map((e) => [e.id, e]));
  const websiteById = new Map(websiteElements.map((e) => [e.id, e]));
  const looseFigma: DesignElement[] = [
    ...pairs.filter((p) => p.figmaId && !p.websiteId).map((p) => figmaById.get(p.figmaId!)!),
    ...unmatchedFigmaSections.flatMap((s) => s.elements),
  ];
  const looseWebsite: DesignElement[] = [
    ...pairs.filter((p) => p.websiteId && !p.figmaId).map((p) => websiteById.get(p.websiteId!)!),
    ...unmatchedWebsiteSections.flatMap((s) => s.elements),
  ];

  const rescuedFigmaIds = new Set<string>();
  const rescuedWebsiteIds = new Set<string>();
  const rescuedPairs: MatchedPair[] = [];
  for (const f of looseFigma) {
    const nf = normalizeText(f.text);
    if (nf.length < 3) continue;
    const match = looseWebsite.find((w) => !rescuedWebsiteIds.has(w.id) && normalizeText(w.text) === nf);
    if (!match) continue;
    rescuedFigmaIds.add(f.id);
    rescuedWebsiteIds.add(match.id);
    rescuedPairs.push({ figmaId: f.id, websiteId: match.id, confidence: 85 });
  }

  if (rescuedPairs.length > 0) {
    pairs = pairs.filter(
      (p) =>
        !((p.figmaId && rescuedFigmaIds.has(p.figmaId) && !p.websiteId) || (p.websiteId && rescuedWebsiteIds.has(p.websiteId) && !p.figmaId))
    );
    pairs.push(...rescuedPairs);
  }

  // A section with nothing to match on the other side is reported once —
  // its elements are deliberately NOT also run through per-element
  // matching (which would just re-produce the same "missing" finding once
  // per element inside it, the exact noise this two-phase approach exists
  // to remove) — except for whatever the rescue pass just pulled out.
  const missingSections = unmatchedFigmaSections
    .map((s) => ({ name: s.name, elements: s.elements.filter((e) => !rescuedFigmaIds.has(e.id)) }))
    .filter((s) => s.elements.length > 0);
  const extraSections = unmatchedWebsiteSections
    .map((s) => ({ name: s.name, elements: s.elements.filter((e) => !rescuedWebsiteIds.has(e.id)) }))
    .filter((s) => s.elements.length > 0);

  return { pairs, missingSections, extraSections };
}
