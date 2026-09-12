import type {
  DesignElement,
  FigmaExtraction,
  WebsiteExtraction,
  MatchedPair,
  Issue,
  IssueCategory,
  Severity,
  ElementType,
} from "./types";
import { normalizeText } from "./similarity";
import { makeId } from "./id";

// Scope, deliberately: only differences meaningful enough for a designer to
// send to a developer. No 1-2px spacing/padding, no tiny font-size or
// alignment nudges, no border-radius nitpicks, no minor position drift —
// those checks were removed outright rather than just tuned, because none
// of them map to any of the 8 result categories this tool now reports
// against (Content, Extra Text, Colors, Images, Icons, Links, Buttons,
// Forms). See README for the full rationale.

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

const colorLabel = (c: string | undefined) => c ?? "not set";

// --- Color comparison --------------------------------------------------------
// Colors are extracted from computed CSS / Figma paint data, not sampled
// from a screenshot, so they're already exact — but small rounding (Figma
// fill percentages, color-space conversions) can still produce a
// technically-different hex that no designer would call a real difference.
// A perceptual-ish Euclidean RGB distance filters that out while still
// catching genuine color swaps (max possible distance is ~441).
function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const COLOR_NOISE_THRESHOLD = 28; // ignore differences this small or smaller

function colorsDiffer(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return false;
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return true; // non-hex (named colors etc.) — exact match already ruled out above
  const [r1, g1, b1] = ca;
  const [r2, g2, b2] = cb;
  const dist = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  return dist > COLOR_NOISE_THRESHOLD;
}

// Which result tab a color/fill difference on this element belongs under.
function colorCategoryFor(type: ElementType): IssueCategory {
  if (type === "icon") return "icons";
  return "colors";
}

/**
 * Walks every matched Figma/website pair and every unmatched element,
 * producing the Content / Colors / Images / Icons / Extra Text issue list.
 * Link/Button/Form functional checks are handled separately in
 * `detectUxIssues` because they come from the live website alone, not a
 * Figma comparison.
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

  issues.push(...compareContainerColors(figma.elements, website.elements, page));

  return issues;
}

// Missing/extra element issues are routed by element type: an image or
// icon gets its own tab even when missing/extra, since "missing image" and
// "missing icon" are explicitly called out as their own checks — anything
// else (text, headings, buttons, links) is a content-presence issue.
function categoryForPresence(type: ElementType, kind: "missing" | "extra"): IssueCategory {
  if (type === "image") return "images";
  if (type === "icon") return "icons";
  return kind === "extra" ? "extra-text" : "content";
}

function missingElementIssue(f: DesignElement, page: string): Issue {
  const highValue: DesignElement["type"][] = ["button", "image", "heading", "component"];
  const severity: Severity = highValue.includes(f.type) ? "high" : "medium";
  return makeIssue({
    category: categoryForPresence(f.type, "missing"),
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
    category: categoryForPresence(w.type, "extra"),
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
      const missingOnWebsite = !nw;
      out.push(
        makeIssue({
          ...base,
          category: "content",
          severity: isImportant ? "high" : "medium",
          title: missingOnWebsite ? `Missing text: "${f.text}"` : `${labelFor(f)} text does not match`,
          description: missingOnWebsite
            ? `This ${f.type}'s text from the Figma design is missing on the live website.`
            : `The text on this ${f.type} differs between the Figma design and the live website.`,
          expected: f.text || "(empty)",
          actual: w.text || "(empty)",
          difference: "Text content differs",
          correction: `Change "${w.text || "(empty)"}" to "${f.text || "(empty)"}".`,
        })
      );
    }
  }

  // --- Colors: text color -------------------------------------------------------
  if (f.color && w.color && colorsDiffer(f.color, w.color)) {
    out.push(
      makeIssue({
        ...base,
        category: colorCategoryFor(f.type),
        severity: f.type === "button" ? "medium" : "low",
        title: `${labelFor(f)} text color does not match`,
        description: "Text color differs meaningfully from the Figma design.",
        expected: colorLabel(f.color),
        actual: colorLabel(w.color),
        difference: "Color does not match",
        correction: `Change the text color to ${f.color}.`,
      })
    );
  }

  // --- Colors: background / fill color -------------------------------------------
  const isLarge = f.width * f.height > 200 * 100;
  if (f.backgroundColor && w.backgroundColor && colorsDiffer(f.backgroundColor, w.backgroundColor)) {
    const isButton = f.type === "button";
    out.push(
      makeIssue({
        ...base,
        category: colorCategoryFor(f.type),
        severity: isButton || isLarge ? "high" : "medium",
        title: isButton ? `${labelFor(f)} color does not match` : `${labelFor(f)} background color does not match`,
        description: `${isButton ? "Button" : "Background"} color differs meaningfully from the Figma design.`,
        expected: colorLabel(f.backgroundColor),
        actual: colorLabel(w.backgroundColor),
        difference: "Color does not match",
        correction: `Change the ${isButton ? "button" : "background"} color to ${f.backgroundColor}.`,
      })
    );
  }

  // --- Colors: gradient fill --------------------------------------------------------
  if (f.gradientStops && !w.gradientStops) {
    out.push(
      makeIssue({
        ...base,
        category: colorCategoryFor(f.type),
        severity: isLarge ? "medium" : "low",
        title: `${labelFor(f)} should be a gradient`,
        description: "This element uses a gradient fill in the Figma design, but the website shows a flat/solid color instead.",
        expected: `Gradient (${f.gradientStops.join(" → ")})`,
        actual: colorLabel(w.backgroundColor ?? w.color),
        difference: "Gradient fill missing",
        correction: `Apply a gradient using: ${f.gradientStops.join(", ")}.`,
      })
    );
  } else if (!f.gradientStops && w.gradientStops) {
    out.push(
      makeIssue({
        ...base,
        category: colorCategoryFor(f.type),
        severity: "low",
        title: `${labelFor(f)} has an unexpected gradient`,
        description: "The website uses a gradient fill here, but the Figma design specifies a flat/solid color.",
        expected: colorLabel(f.backgroundColor ?? f.color),
        actual: `Gradient (${w.gradientStops.join(" → ")})`,
        difference: "Unexpected gradient fill",
        correction: `Replace the gradient with a solid color: ${f.backgroundColor ?? f.color ?? "as specified in Figma"}.`,
      })
    );
  } else if (f.gradientStops && w.gradientStops && f.gradientStops.join("|") !== w.gradientStops.join("|")) {
    out.push(
      makeIssue({
        ...base,
        category: colorCategoryFor(f.type),
        severity: isLarge ? "medium" : "low",
        title: `${labelFor(f)} gradient colors do not match`,
        description: "The gradient's colors differ from the Figma design.",
        expected: f.gradientStops.join(" → "),
        actual: w.gradientStops.join(" → "),
        difference: "Gradient colors do not match",
        correction: `Update the gradient to use: ${f.gradientStops.join(", ")}.`,
      })
    );
  }

  // --- Colors: border color -----------------------------------------------------
  // Only worth comparing when there's an actual visible border on at least
  // one side — an invisible (0px) border's color is meaningless noise.
  const hasVisibleBorder = (f.borderWidth ?? 0) > 0 || (w.borderWidth ?? 0) > 0;
  if (hasVisibleBorder && f.borderColor && w.borderColor && colorsDiffer(f.borderColor, w.borderColor)) {
    out.push(
      makeIssue({
        ...base,
        category: colorCategoryFor(f.type),
        severity: "low",
        title: `${labelFor(f)} border color does not match`,
        description: "Border color differs meaningfully from the Figma design.",
        expected: colorLabel(f.borderColor),
        actual: colorLabel(w.borderColor),
        difference: "Color does not match",
        correction: `Change the border color to ${f.borderColor}.`,
      })
    );
  }

  return out;
}

function labelFor(el: DesignElement): string {
  return el.name || el.section || el.type;
}

// Section-level background color (Figma "Hero Section" vs its website
// counterpart, matched by name) — the one container-level check kept from
// the old spacing/padding/gap comparison, since a wrong section background
// is a real, visible color difference, not a minor layout nudge.
function compareContainerColors(figmaEls: DesignElement[], websiteEls: DesignElement[], page: string): Issue[] {
  const out: Issue[] = [];
  const figmaContainers = figmaEls.filter((e) => e.type === "section" || e.type === "container");
  const websiteContainers = websiteEls.filter((e) => e.type === "section" || e.type === "container");

  for (const f of figmaContainers) {
    const w = websiteContainers.find((c) => normalizeText(c.name) === normalizeText(f.name));
    if (!w) continue;
    if (f.backgroundColor && w.backgroundColor && colorsDiffer(f.backgroundColor, w.backgroundColor)) {
      out.push(
        makeIssue({
          category: "colors",
          severity: f.width * f.height > 300 * 100 ? "high" : "medium",
          title: `${f.name} background color does not match`,
          section: f.name,
          page,
          description: "This section's background color differs meaningfully from the Figma design.",
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
  }

  return out;
}

/**
 * Functional checks that come purely from the live website (not a Figma
 * comparison): broken links, broken/missing images, non-functional
 * buttons, and forms with no way to submit.
 */
export function detectUxIssues(website: WebsiteExtraction, page: string): Issue[] {
  const issues: Issue[] = [];

  for (const link of website.brokenLinks) {
    issues.push(
      makeIssue({
        category: "links",
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
        category: "images",
        severity: "high",
        title: "Missing image",
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

  for (const btn of website.brokenButtons) {
    issues.push(
      makeIssue({
        category: "buttons",
        severity: "high",
        title: `Button has no destination: "${btn}"`,
        section: "Page-wide",
        page,
        description: `This button/link has no real destination configured (empty or placeholder href), so clicking it does nothing. Heuristic check — actual clicking wasn't performed to avoid side effects on the live site.`,
        expected: "A working link or action",
        actual: "No destination configured",
        difference: "Button appears non-functional",
        correction: "Wire this button up to its intended link or action.",
        matchConfidence: null,
      })
    );
  }

  for (const form of website.brokenForms) {
    issues.push(
      makeIssue({
        category: "forms",
        severity: "high",
        title: `Form may not submit: ${form}`,
        section: "Page-wide",
        page,
        description: "This form has input fields but no visible submit button, so users may not be able to submit it. Heuristic structural check — actual submission wasn't tested to avoid sending real data.",
        expected: "A submit button or control",
        actual: "No submit control found",
        difference: "Form has no way to submit",
        correction: "Add a submit button, or verify the submission is triggered another way.",
        matchConfidence: null,
      })
    );
  }

  return issues;
}
