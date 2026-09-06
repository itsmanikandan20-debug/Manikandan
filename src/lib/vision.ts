// Uses Google Gemini's free tier (no credit card required) to read the
// uploaded screenshot. Called via plain fetch — no paid SDK needed.

export interface DesignAnalysis {
  detectedLayout: string;
  dominantColors: string[];
  typography: string;
  heroSummary: string;
  styleSummary: string;
}

// Override via env if this model ID is retired — check https://ai.google.dev/models
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

export async function analyzeDesignWithGemini(
  base64Image: string,
  mediaType: string
): Promise<DesignAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let json: Record<string, unknown>;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: ANALYSIS_PROMPT },
                { inline_data: { mime_type: mediaType, data: base64Image } },
              ],
            },
          ],
        }),
      }
    );
    json = await res.json();
    if (!res.ok) {
      const message =
        typeof json?.error === "object" && json.error && "message" in json.error
          ? String((json.error as { message: unknown }).message)
          : `Gemini request failed (${res.status})`;
      throw new Error(message);
    }
  } finally {
    clearTimeout(timeout);
  }

  const candidates = json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const raw = candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Gemini did not return valid JSON for the design analysis");
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
