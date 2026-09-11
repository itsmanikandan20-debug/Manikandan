import type {
  DesignElement,
  FigmaExtraction,
  WebsiteExtraction,
  MatchedPair,
  Issue,
  IssueCategory,
  Severity,
} from "./types";
import { normalizeText, round } from "./similarity";
import { makeId } from "./id";

// Issue numbers (#1, #2, #3…) are assigned once, at the end, by
// numberIssues() below — never here. Two different designers can hit the
// same warm serverless instance at the same moment; a shared/module-level
// counter would let their concurrent requests interleave and corrupt each
// other's numbering. Keeping this function pure (no counter, no
// server-wide state) means every request is fully isolated from every
// other request, no matter how Vercel schedules them.
function makeIssue(partial: Omit<Issue, "id" | "number" | "status">): Issue {
  return {
    id: makeId("issue"),
    number: 0,
    status: "open",
    ...partial,
  };
}

// Exposed for callers that need to hand-author an issue outside the
// automatic comparison (e.g. the demo dataset, or a bespoke accessibility
// check).
export const createIssue = makeIssue;

/**
 * Assigns final, sequential #1, #2, #3… issue numbers based on array
 * order. Call this once, after every issue for one analysis has been
 * collected (compare + UX + any hand-authored ones) — it takes a plain
 * array in and returns a plain array out, with no shared state involved,
 * so it's safe to call from concurrent requests.
 */
export function numberIssues(issues: Issue[]): Issue[] {
  return issues.map((issue, i) => ({ ...issue, number: i + 1 }));
}

function byId(elements: DesignElement[]): Map<string, DesignElement> {
  return new Map(elements.map((e) => [e.id, e]));
}

const px = (n: number | undefined) => (n === undefined ? "—" : `${round(n)}px`);
const colorLabel = (c: string | undefined) => c ?? "not set";

/**
 * Walks every matched Figma/website pair and every unmatched element,
 * producing the full Visual + Content + Layout issue list. UX issues
 * (broken links, overflow, accessibility) are handled separately in
 * `detectUxIssues` because they don't come from a Figma comparison.
 */
export function compareDesignToWebsite(
  figma: FigmaExtraction,
  website: WebsiteExtraction,
  matches: MatchedPair[],
  page: string
): Issue[] {
  const issues: Issue[] = [];
  const figmaById = byId(figma.elements);
  const websiteById = byId(website.elements);

  for (const pair of matches) {
    const f = pair.figmaId ? figmaById.get(pair.figmaId) : undefined;
    const w = pair.websiteId ? websiteById.get(pair.websiteId) : undefined;

    if (f && !w) {
      issues.push(missingElementIssue(f, page));
      continue;
    }
    if (w && !f) {
      issues.push(extraElementIssue(w, page));
      continue;
    }
    if (f && w) {
      issues.push(...comparePair(f, w, pair.confidence, page));
    }
  }

  issues.push(...compareContainers(figma.elements, website.elements, page));

  return issues;
}

function missingElementIssue(f: DesignElement, page: string): Issue {
  const highValue: DesignElement["type"][] = ["button", "image", "heading", "component"];
  const severity: Severity = highValue.includes(f.type) ? "high" : "medium";
  const category: IssueCategory = f.type === "image" || f.type === "icon" ? "layout" : "content";
  return makeIssue({
    category,
    severity,
    title: `Missing ${f.type}: "${f.text || f.name}"`,
    section: f.section,
    page,
    description: `This ${f.type} exists in the Figma design but was not found anywhere on the live website.`,
    expected: f.text || f.name,
    actual: "Not present on the website",
    difference: "Element missing entirely",
    correction: `Add the missing ${f.type} ("${f.text || f.name}") to the ${f.section} section, matching the Figma design.`,
    matchConfidence: null,
    figmaElementId: f.id,
    boundingBox: { x: f.x, y: f.y, width: f.width, height: f.height },
  });
}

function extraElementIssue(w: DesignElement, page: string): Issue {
  return makeIssue({
    category: "layout",
    severity: "low",
    title: `Extra ${w.type} not in Figma: "${w.text || w.name}"`,
    section: w.section,
    page,
    description: `This ${w.type} appears on the live website but has no corresponding element in the Figma design.`,
    expected: "Not present in the design",
    actual: w.text || w.name,
    difference: "Extra, unplanned element",
    correction: "Confirm with design whether this element should be removed or added to the source design file.",
    matchConfidence: null,
    websiteElementId: w.id,
    websiteSelector: w.selector,
    boundingBox: { x: w.x, y: w.y, width: w.width, height: w.height },
  });
}

function comparePair(f: DesignElement, w: DesignElement, confidence: number, page: string): Issue[] {
  const out: Issue[] = [];
  const box = { x: w.x, y: w.y, width: w.width, height: w.height };
  const base = {
    section: f.section || w.section,
    page,
    matchConfidence: confidence,
    figmaElementId: f.id,
    websiteElementId: w.id,
    websiteSelector: w.selector,
    boundingBox: box,
  };

  // --- Content: text mismatch -------------------------------------------------
  if (f.text !== undefined || w.text !== undefined) {
    const nf = normalizeText(f.text);
    const nw = normalizeText(w.text);
    if (nf !== nw && (nf || nw)) {
      const isImportant = f.type === "button" || f.type === "heading";
      out.push(
        makeIssue({
          ...base,
          category: "content",
          severity: isImportant ? "high" : "medium",
          title: `${labelFor(f)} text does not match`,
          description: `The text on this ${f.type} differs between the Figma design and the live website.`,
          expected: f.text || "(empty)",
          actual: w.text || "(empty)",
          difference: "Text content differs",
          correction: `Change "${w.text || "(empty)"}" to "${f.text || "(empty)"}".`,
        })
      );
    }
  }

  // --- Visual: font family -----------------------------------------------------
  if (f.fontFamily && w.fontFamily && normalizeText(f.fontFamily) !== normalizeText(w.fontFamily)) {
    out.push(
      makeIssue({
        ...base,
        category: "visual",
        severity: "low",
        title: `${labelFor(f)} font family mismatch`,
        description: "The implemented font family does not match the one specified in Figma.",
        expected: f.fontFamily,
        actual: w.fontFamily,
        difference: `"${w.fontFamily}" instead of "${f.fontFamily}"`,
        correction: `Update the font-family to "${f.fontFamily}".`,
      })
    );
  }

  // --- Visual: font size --------------------------------------------------------
  if (f.fontSize && w.fontSize && Math.abs(f.fontSize - w.fontSize) >= 2) {
    out.push(
      makeIssue({
        ...base,
        category: "visual",
        severity: Math.abs(f.fontSize - w.fontSize) >= 8 ? "medium" : "low",
        title: `${labelFor(f)} font size mismatch`,
        description: "The rendered font size does not match the Figma design.",
        expected: px(f.fontSize),
        actual: px(w.fontSize),
        difference: px(Math.abs(f.fontSize - w.fontSize)),
        correction: `Set font-size to ${px(f.fontSize)}.`,
      })
    );
  }

  // --- Visual: color -------------------------------------------------------------
  if (f.color && w.color && normalizeText(f.color) !== normalizeText(w.color)) {
    out.push(
      makeIssue({
        ...base,
        category: "visual",
        severity: "low",
        title: `${labelFor(f)} text color mismatch`,
        description: "Text color differs from the Figma design.",
        expected: colorLabel(f.color),
        actual: colorLabel(w.color),
        difference: "Color does not match",
        correction: `Change the text color to ${f.color}.`,
      })
    );
  }

  // --- Visual: background color ---------------------------------------------------
  if (f.backgroundColor && w.backgroundColor && normalizeText(f.backgroundColor) !== normalizeText(w.backgroundColor)) {
    const isLarge = f.width * f.height > 200 * 100;
    out.push(
      makeIssue({
        ...base,
        category: "visual",
        severity: isLarge ? "medium" : "low",
        title: `${labelFor(f)} background color mismatch`,
        description: "Background/fill color differs from the Figma design.",
        expected: colorLabel(f.backgroundColor),
        actual: colorLabel(w.backgroundColor),
        difference: "Color does not match",
        correction: `Change the background color to ${f.backgroundColor}.`,
      })
    );
  }

  // --- Visual: border radius --------------------------------------------------------
  if (f.borderRadius !== undefined && w.borderRadius !== undefined && Math.abs(f.borderRadius - w.borderRadius) >= 2) {
    out.push(
      makeIssue({
        ...base,
        category: "visual",
        severity: "low",
        title: `${labelFor(f)} border radius mismatch`,
        description: "Corner rounding does not match the Figma design.",
        expected: px(f.borderRadius),
        actual: px(w.borderRadius),
        difference: px(Math.abs(f.borderRadius - w.borderRadius)),
        correction: `Set border-radius to ${px(f.borderRadius)}.`,
      })
    );
  }

  // Structural groupings (feature cards, footer columns, ...) shouldn't be
  // flagged for size/position individually — their spacing is already
  // covered by the container gap/padding check in compareContainers, and
  // double-reporting the same root cause as two separate issues is noise.
  const isStructuralGroup = f.type === "component" && !f.text;
  let sizeIssueFlagged = false;

  if (!isStructuralGroup) {
    // --- Layout: size -------------------------------------------------------------
    const widthDiffPct = f.width > 0 ? Math.abs(f.width - w.width) / f.width : 0;
    const heightDiffPct = f.height > 0 ? Math.abs(f.height - w.height) / f.height : 0;
    if (widthDiffPct > 0.12 || heightDiffPct > 0.12) {
      sizeIssueFlagged = true;
      out.push(
        makeIssue({
          ...base,
          category: "layout",
          severity: Math.max(widthDiffPct, heightDiffPct) > 0.3 ? "medium" : "low",
          title: `${labelFor(f)} size does not match design`,
          description: "This element's rendered dimensions differ noticeably from Figma.",
          expected: `${round(f.width)} × ${round(f.height)}px`,
          actual: `${round(w.width)} × ${round(w.height)}px`,
          difference: `${px(Math.abs(f.width - w.width))} wide, ${px(Math.abs(f.height - w.height))} tall`,
          correction: `Resize to ${round(f.width)} × ${round(f.height)}px to match the design.`,
        })
      );
    }

    // --- Layout: position ---------------------------------------------------------
    // Skip if a size mismatch was already reported for this same element —
    // a resized, edge-anchored element (e.g. a right-aligned button that
    // got narrower) naturally shifts position as a side effect, and that's
    // one root cause, not two separate issues.
    const dx = Math.abs(f.x - w.x);
    const dy = Math.abs(f.y - w.y);
    if (!sizeIssueFlagged && (dx > 24 || dy > 24)) {
      out.push(
        makeIssue({
          ...base,
          category: "layout",
          severity: Math.max(dx, dy) > 60 ? "medium" : "low",
          title: `${labelFor(f)} incorrectly positioned`,
          description: "This element's position on the page has drifted from the Figma layout.",
          expected: `x: ${round(f.x)}px, y: ${round(f.y)}px`,
          actual: `x: ${round(w.x)}px, y: ${round(w.y)}px`,
          difference: `offset by ${px(dx)} horizontally, ${px(dy)} vertically`,
          correction: "Reposition the element to match the Figma layout coordinates.",
        })
      );
    }
  }

  return out;
}

function labelFor(el: DesignElement): string {
  return el.name || el.section || el.type;
}

// Compares container-level spacing (padding / gap) between Figma sections
// and their matching website sections, by section name — this is what
// produces issues like "Hero Section Spacing: Expected 64px, Actual 48px".
function compareContainers(figmaEls: DesignElement[], websiteEls: DesignElement[], page: string): Issue[] {
  const out: Issue[] = [];
  const figmaContainers = figmaEls.filter((e) => e.type === "section" || e.type === "container");
  const websiteContainers = websiteEls.filter((e) => e.type === "section" || e.type === "container");

  for (const f of figmaContainers) {
    const w = websiteContainers.find((c) => normalizeText(c.name) === normalizeText(f.name));
    if (!w) continue;

    if (f.backgroundColor && w.backgroundColor && normalizeText(f.backgroundColor) !== normalizeText(w.backgroundColor)) {
      out.push(
        makeIssue({
          category: "visual",
          severity: f.width * f.height > 300 * 100 ? "medium" : "low",
          title: `${f.name} background color mismatch`,
          section: f.name,
          page,
          description: "This section's background color differs from the Figma design.",
          expected: f.backgroundColor,
          actual: w.backgroundColor,
          difference: "Color does not match",
          correction: `Change the background color to ${f.backgroundColor}.`,
          matchConfidence: 100,
          figmaElementId: f.id,
          websiteElementId: w.id,
          websiteSelector: w.selector,
          boundingBox: { x: w.x, y: w.y, width: w.width, height: w.height },
        })
      );
    }

    if (f.paddingTop !== undefined && w.paddingTop !== undefined && Math.abs(f.paddingTop - w.paddingTop) >= 8) {
      const diff = Math.abs(f.paddingTop - w.paddingTop);
      out.push(
        makeIssue({
          category: "layout",
          severity: diff / f.paddingTop > 0.2 ? "medium" : "low",
          title: `${f.name} spacing`,
          section: f.name,
          page,
          description: "Top padding for this section does not match the Figma spec.",
          expected: px(f.paddingTop),
          actual: px(w.paddingTop),
          difference: px(diff),
          correction: `Set top padding to ${px(f.paddingTop)}.`,
          matchConfidence: 100,
          figmaElementId: f.id,
          websiteElementId: w.id,
          websiteSelector: w.selector,
          boundingBox: { x: w.x, y: w.y, width: w.width, height: Math.min(w.height, 120) },
        })
      );
    }

    if (f.gap !== undefined && w.gap !== undefined && Math.abs(f.gap - w.gap) >= 8) {
      const diff = Math.abs(f.gap - w.gap);
      out.push(
        makeIssue({
          category: "layout",
          severity: diff > 40 ? "medium" : "low",
          title: `${f.name} alignment & spacing`,
          section: f.name,
          page,
          description: "The gap between items in this section does not match the auto-layout spacing defined in Figma.",
          expected: px(f.gap),
          actual: px(w.gap),
          difference: px(diff),
          correction: `Set the gap between items to ${px(f.gap)} and confirm alignment matches the Figma auto-layout.`,
          matchConfidence: 100,
          figmaElementId: f.id,
          websiteElementId: w.id,
          websiteSelector: w.selector,
          boundingBox: { x: w.x, y: w.y, width: w.width, height: w.height },
        })
      );
    }
  }

  return out;
}

/**
 * UX checks that come purely from the live website (not a Figma
 * comparison): broken links/images, overflow, and simple accessibility
 * heuristics.
 */
export function detectUxIssues(website: WebsiteExtraction, page: string): Issue[] {
  const issues: Issue[] = [];

  for (const link of website.brokenLinks) {
    issues.push(
      makeIssue({
        category: "ux",
        severity: "high",
        title: "Broken link",
        section: "Page-wide",
        page,
        description: `A link on the page points to a URL that did not resolve: ${link}`,
        expected: "Link should load a valid page",
        actual: link,
        difference: "Link is broken or unreachable",
        correction: "Fix or remove this link.",
        matchConfidence: null,
      })
    );
  }

  for (const img of website.brokenImages) {
    issues.push(
      makeIssue({
        category: "ux",
        severity: "high",
        title: "Broken image",
        section: "Page-wide",
        page,
        description: `An <img> tag failed to load its source: ${img}`,
        expected: "Image should load successfully",
        actual: "Failed to load / missing src",
        difference: "Image is broken or missing",
        correction: "Fix the image source or re-upload the asset.",
        matchConfidence: null,
      })
    );
  }

  const overflowing = website.elements.filter(
    (el) => el.width > website.viewport.width + 4 && el.type !== "frame"
  );
  for (const el of overflowing.slice(0, 3)) {
    issues.push(
      makeIssue({
        category: "ux",
        severity: "medium",
        title: `${labelFor(el)} overflows the viewport`,
        section: el.section,
        page,
        description: "This element is wider than the viewport, which can cause unwanted horizontal scrolling.",
        expected: `Width ≤ ${website.viewport.width}px`,
        actual: `${round(el.width)}px wide`,
        difference: `${round(el.width - website.viewport.width)}px too wide`,
        correction: "Constrain this element's width or add responsive wrapping.",
        matchConfidence: null,
        websiteElementId: el.id,
        websiteSelector: el.selector,
        boundingBox: { x: el.x, y: el.y, width: el.width, height: el.height },
      })
    );
  }

  return issues;
}
