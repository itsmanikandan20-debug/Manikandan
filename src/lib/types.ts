// Core domain types for Design Similarity Finder.

/** The three-stage confidence ladder the product promises never to blur together. */
export type IdentificationStage =
  | "similar_image_found" // A visually close match exists somewhere on the web.
  | "source_identified" // We believe we know which live site it belongs to.
  | "live_verified" // We fetched that URL just now and confirmed it's live and matches.
  | "source_not_found"; // No confident source — shown honestly instead of guessed.

export interface AttributeScore {
  attribute:
    | "Layout"
    | "Hero section"
    | "Colour palette"
    | "Typography"
    | "Card structure"
    | "Spacing"
    | "Overall visual style";
  score: number; // 0-100
  note: string; // short human-readable reason for the score
}

export interface UploadedDesign {
  id: string;
  fileName: string;
  imageUrl: string;
  uploadedAt: string; // ISO date
  dominantColors: string[]; // hex values extracted from the screenshot
  detectedLayout: string; // e.g. "Split hero, 3-column feature grid"
}

export interface MatchResult {
  id: string;
  websiteName: string;
  screenshotUrl: string;
  liveUrl: string | null; // null when source_not_found
  stage: IdentificationStage;
  similarityScore: number; // 0-100 overall
  matchedAttributes: AttributeScore[];
  matchedOn: string[]; // short tags e.g. ["Layout", "Colour palette"]
  lastCheckedAt: string; // ISO date the live-verification happened
}

export interface SearchRecord {
  id: string;
  design: UploadedDesign;
  results: MatchResult[];
  createdAt: string; // ISO date
  status: "completed" | "processing" | "no_matches";
}
