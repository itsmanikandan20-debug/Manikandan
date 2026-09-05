import Anthropic from "@anthropic-ai/sdk";

export interface DesignAnalysis {
  detectedLayout: string;
  dominantColors: string[];
  typography: string;
  heroSummary: string;
  styleSummary: string;
}

// Haiku is the cheapest current vision-capable model — a good default
// when cost matters more than maximum accuracy. Override via env if needed.
const VISION_MODEL = process.env.ANTHROPIC_VISION_MODEL || "claude-haiku-4-5-20251001";

const ANALYSIS_PROMPT = `You are analyzing a screenshot of a website or app design (likely exported from Figma).
Respond with ONLY a JSON object, no markdown fences, no commentary, matching exactly this shape:
{
  "detectedLayout": "one short sentence describing the overall page layout and structure",
  "dominantColors": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "typography": "one short sentence describing the typeface style, weight, and hierarchy",
  "heroSummary": "one short sentence describing the hero/top section specifically",
  "styleSummary": "one short sentence describing the overall visual style (e.g. minimal, corporate, playful, dark, brutalist)"
}
Estimate dominantColors as best you can as hex codes, ordered from most to least dominant.`;

export async function analyzeDesignWithClaude(
  base64Image: string,
  mediaType: string
): Promise<DesignAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/png" | "image/jpeg" | "image/webp",
              data: base64Image,
            },
          },
          { type: "text", text: ANALYSIS_PROMPT },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Claude did not return valid JSON for the design analysis");
  }

  return {
    detectedLayout: String(parsed.detectedLayout ?? "Layout could not be determined"),
    dominantColors: Array.isArray(parsed.dominantColors)
      ? (parsed.dominantColors as unknown[]).map(String).slice(0, 6)
      : [],
    typography: String(parsed.typography ?? ""),
    heroSummary: String(parsed.heroSummary ?? ""),
    styleSummary: String(parsed.styleSummary ?? ""),
  };
}
