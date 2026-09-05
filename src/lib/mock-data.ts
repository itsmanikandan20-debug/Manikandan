import type { MatchResult, SearchRecord, UploadedDesign } from "./types";

export const currentUpload: UploadedDesign = {
  id: "upload-fintech-01",
  fileName: "fintech-landing-v3.png",
  imageUrl: "https://picsum.photos/seed/fintech-hero/960/720",
  uploadedAt: "2026-09-05T09:14:00Z",
  dominantColors: ["#6931CC", "#181321", "#FAF9FC", "#2F6FED", "#E7E3EE"],
  detectedLayout:
    "Centered hero with gradient backdrop, sticky top nav, three-column feature grid, testimonial band",
};

export const currentMatches: MatchResult[] = [
  {
    id: "match-01",
    websiteName: "Mercury",
    screenshotUrl: "https://picsum.photos/seed/mercury-site/640/440",
    liveUrl: "https://mercury.com",
    stage: "live_verified",
    similarityScore: 92,
    matchedOn: ["Layout", "Colour palette", "Hero section"],
    lastCheckedAt: "2026-09-05T09:16:00Z",
    matchedAttributes: [
      { attribute: "Layout", score: 95, note: "Same centered hero + 3-column grid rhythm" },
      { attribute: "Hero section", score: 91, note: "Matching headline weight and CTA placement" },
      { attribute: "Colour palette", score: 94, note: "Near-identical deep violet on off-white" },
      { attribute: "Typography", score: 82, note: "Similar geometric sans, different weight scale" },
      { attribute: "Card structure", score: 90, note: "Rounded feature cards with icon-top layout" },
      { attribute: "Spacing", score: 93, note: "Matching generous section padding" },
      { attribute: "Overall visual style", score: 92, note: "Reads as the same design language" },
    ],
  },
  {
    id: "match-02",
    websiteName: "Ramp",
    screenshotUrl: "https://picsum.photos/seed/ramp-site/640/440",
    liveUrl: "https://ramp.com",
    stage: "live_verified",
    similarityScore: 87,
    matchedOn: ["Layout", "Card structure", "Spacing"],
    lastCheckedAt: "2026-09-05T09:16:00Z",
    matchedAttributes: [
      { attribute: "Layout", score: 89, note: "Same sticky nav and grid structure" },
      { attribute: "Hero section", score: 74, note: "Different hero media treatment" },
      { attribute: "Colour palette", score: 80, note: "Shares the violet accent, lighter overall tone" },
      { attribute: "Typography", score: 85, note: "Comparable type scale and line height" },
      { attribute: "Card structure", score: 92, note: "Matching rounded-corner card grid" },
      { attribute: "Spacing", score: 90, note: "Similar vertical rhythm between sections" },
      { attribute: "Overall visual style", score: 87, note: "Very close overall composition" },
    ],
  },
  {
    id: "match-03",
    websiteName: "Retool",
    screenshotUrl: "https://picsum.photos/seed/retool-site/640/440",
    liveUrl: "https://retool.com",
    stage: "source_identified",
    similarityScore: 78,
    matchedOn: ["Typography", "Colour palette"],
    lastCheckedAt: "2026-09-05T09:16:00Z",
    matchedAttributes: [
      { attribute: "Layout", score: 68, note: "Different nav pattern, similar section order" },
      { attribute: "Hero section", score: 71, note: "Comparable headline hierarchy" },
      { attribute: "Colour palette", score: 83, note: "Shares dark-ink-on-light-violet accents" },
      { attribute: "Typography", score: 88, note: "Very close type pairing and tracking" },
      { attribute: "Card structure", score: 74, note: "Similar card padding, different border treatment" },
      { attribute: "Spacing", score: 79, note: "Comparable but slightly tighter spacing" },
      { attribute: "Overall visual style", score: 78, note: "Recognisably related visual family" },
    ],
  },
  {
    id: "match-04",
    websiteName: "Unverified match — found on Dribbble",
    screenshotUrl: "https://picsum.photos/seed/dribbble-shot/640/440",
    liveUrl: "https://dribbble.com/shots/example-fintech-concept",
    stage: "similar_image_found",
    similarityScore: 65,
    matchedOn: ["Colour palette", "Card structure"],
    lastCheckedAt: "2026-09-05T09:16:00Z",
    matchedAttributes: [
      { attribute: "Layout", score: 61, note: "Loosely similar section order" },
      { attribute: "Hero section", score: 58, note: "Different hero composition" },
      { attribute: "Colour palette", score: 76, note: "Same violet-and-ink palette" },
      { attribute: "Typography", score: 55, note: "Different typeface family entirely" },
      { attribute: "Card structure", score: 70, note: "Similar rounded card grid" },
      { attribute: "Spacing", score: 64, note: "Comparable section padding" },
      { attribute: "Overall visual style", score: 65, note: "Same design concept, unclear if shipped live" },
    ],
  },
  {
    id: "match-05",
    websiteName: "Source website not found",
    screenshotUrl: "https://picsum.photos/seed/unresolved-match/640/440",
    liveUrl: null,
    stage: "source_not_found",
    similarityScore: 54,
    matchedOn: ["Spacing"],
    lastCheckedAt: "2026-09-05T09:16:00Z",
    matchedAttributes: [
      { attribute: "Layout", score: 52, note: "Some structural overlap only" },
      { attribute: "Hero section", score: 41, note: "Weak match" },
      { attribute: "Colour palette", score: 48, note: "Partial palette overlap" },
      { attribute: "Typography", score: 44, note: "Different type system" },
      { attribute: "Card structure", score: 50, note: "Loose resemblance" },
      { attribute: "Spacing", score: 61, note: "Closest match on this attribute" },
      { attribute: "Overall visual style", score: 54, note: "Below confidence threshold to identify a source" },
    ],
  },
];

export const searchHistory: SearchRecord[] = [
  {
    id: "search-2026-09-05",
    design: currentUpload,
    results: currentMatches,
    createdAt: "2026-09-05T09:14:00Z",
    status: "completed",
  },
  {
    id: "search-2026-09-02",
    design: {
      id: "upload-ecom-02",
      fileName: "shopfront-checkout.png",
      imageUrl: "https://picsum.photos/seed/ecom-checkout/960/720",
      uploadedAt: "2026-09-02T14:02:00Z",
      dominantColors: ["#181321", "#F5F2FD", "#1D9A6C", "#FAF9FC"],
      detectedLayout: "Two-column checkout with sticky order summary",
    },
    results: [
      {
        id: "match-06",
        websiteName: "Shopify Editions",
        screenshotUrl: "https://picsum.photos/seed/shopify-edit/640/440",
        liveUrl: "https://shopify.com",
        stage: "live_verified",
        similarityScore: 84,
        matchedOn: ["Layout", "Card structure"],
        lastCheckedAt: "2026-09-02T14:05:00Z",
        matchedAttributes: [],
      },
    ],
    createdAt: "2026-09-02T14:02:00Z",
    status: "completed",
  },
  {
    id: "search-2026-08-27",
    design: {
      id: "upload-mobile-03",
      fileName: "habit-tracker-onboarding.png",
      imageUrl: "https://picsum.photos/seed/habit-app/960/720",
      uploadedAt: "2026-08-27T11:40:00Z",
      dominantColors: ["#6931CC", "#FFFFFF", "#181321"],
      detectedLayout: "Full-bleed mobile onboarding carousel",
    },
    results: [],
    createdAt: "2026-08-27T11:40:00Z",
    status: "no_matches",
  },
];

export function getStageLabel(stage: MatchResult["stage"]): string {
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
