// Shared domain types for DesignCheck.
// These describe the normalized shape we reduce both Figma and the live
// website down to, so the comparison engine can treat them the same way.

export type Viewport = {
  label: string;
  width: number;
  height: number;
};

export const VIEWPORTS: Viewport[] = [
  { label: "1440 × 900 (Desktop)", width: 1440, height: 900 },
  { label: "1366 × 768 (Laptop)", width: 1366, height: 768 },
  { label: "1280 × 800 (Small laptop)", width: 1280, height: 800 },
  { label: "1024 × 768 (Tablet landscape)", width: 1024, height: 768 },
  { label: "768 × 1024 (Tablet portrait)", width: 768, height: 1024 },
  { label: "390 × 844 (Mobile)", width: 390, height: 844 },
];

export type ElementType =
  | "frame"
  | "section"
  | "heading"
  | "paragraph"
  | "text"
  | "button"
  | "image"
  | "icon"
  | "input"
  | "link"
  | "component"
  | "container";

// A normalized visual element, extracted from either Figma or the DOM.
export interface DesignElement {
  id: string;
  source: "figma" | "website";
  type: ElementType;
  name: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  color?: string;
  backgroundColor?: string;
  // Present instead of backgroundColor when the fill is a gradient rather
  // than a solid color — an ordered list of the gradient's stop colors.
  gradientStops?: string[];
  borderRadius?: number;
  // Only meaningful when borderWidth > 0 — an invisible (0px) border's
  // color is never worth comparing.
  borderColor?: string;
  borderWidth?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  gap?: number;
  opacity?: number;
  imageUrl?: string;
  href?: string;
  selector?: string; // CSS selector, website elements only
  autoLayout?: "horizontal" | "vertical" | "none";
  section: string; // human label like "Hero", "Header", "Footer"
  children?: string[]; // ids of children, for reference only
}

export interface FigmaExtraction {
  fileKey: string;
  fileName: string;
  pageName: string;
  frameName: string;
  frameWidth: number;
  frameHeight: number;
  thumbnailUrl?: string;
  elements: DesignElement[];
  isDemo: boolean;
}

export interface WebsiteExtraction {
  url: string;
  finalUrl: string;
  viewport: Viewport;
  screenshotDataUrl?: string;
  screenshotUrl?: string;
  elements: DesignElement[];
  brokenLinks: string[];
  brokenImages: string[];
  // Heuristic, non-destructive checks — no button was clicked and no form
  // was submitted. A "broken" button here means it has no real destination
  // configured (empty/placeholder href); a "broken" form means it has no
  // submit control at all. Real click/submit testing isn't performed since
  // that could trigger actual side effects (navigation, real form
  // submissions) on a live production site.
  brokenButtons: string[];
  brokenForms: string[];
  isDemo: boolean;
  // True if the page looked like a bot-detection interstitial (Cloudflare,
  // reCAPTCHA, etc.) even after waiting for it to clear — meaning the
  // screenshot/elements below likely show that challenge page, not the
  // real site.
  botChallengeDetected?: boolean;
}

// Scoped to meaningful, developer-actionable differences only — no
// spacing/padding/font-size/alignment/border-radius nitpicks. "extra-text"
// is split out from "content" so unplanned copy on the live site (not
// missing/wrong copy) gets its own tab. "links"/"buttons"/"forms" are
// functional website checks, not Figma comparisons.
export type IssueCategory = "content" | "extra-text" | "colors" | "images" | "icons" | "links" | "buttons" | "forms";
export type Severity = "high" | "medium" | "low";
export type IssueStatus = "open" | "approved" | "rejected" | "fixed";

export interface MatchedPair {
  figmaId: string | null;
  websiteId: string | null;
  confidence: number; // 0-100
}

export interface Issue {
  id: string;
  number: number;
  category: IssueCategory;
  severity: Severity;
  title: string;
  section: string;
  page: string;
  description: string;
  expected: string;
  actual: string;
  difference: string;
  correction: string;
  matchConfidence: number | null;
  figmaElementId?: string;
  websiteElementId?: string;
  websiteSelector?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  status: IssueStatus;
  designerComment?: string;
  aiExplanation?: string;
}

export interface CategoryScores {
  content: number;
  extraText: number;
  colors: number;
  images: number;
  icons: number;
  links: number;
  buttons: number;
  forms: number;
}

export interface ResponsiveFinding {
  viewport: Viewport;
  issues: {
    type:
      | "overflow"
      | "overlap"
      | "text-cutoff"
      | "button-unusable"
      | "image-broken"
      | "nav-broken"
      | "layout-unusable";
    description: string;
    severity: Severity;
    selector?: string;
  }[];
  screenshotDataUrl?: string;
  screenshotUrl?: string;
}

export interface AnalysisResult {
  id: string;
  createdAt: string;
  figmaUrl: string;
  websiteUrl: string;
  viewport: Viewport;
  isDemo: boolean;
  figma: FigmaExtraction;
  website: WebsiteExtraction;
  matches: MatchedPair[];
  issues: Issue[];
  overallScore: number;
  categoryScores: CategoryScores;
  responsive: ResponsiveFinding[];
  warnings: string[];
}

export interface AnalyzeRequestBody {
  // Exactly one of these two must be provided: figmaUrl fetches the
  // design live via the signed-in designer's Figma OAuth session;
  // figmaExtraction is a design already parsed client-side from an
  // uploaded SVG export, needing no Figma connection at all.
  figmaUrl?: string;
  figmaExtraction?: FigmaExtraction;
  websiteUrl: string;
  viewportIndex: number;
  checkResponsive: boolean;
}
