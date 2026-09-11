import type { Issue } from "./types";

// AI is used for exactly one thing in this app: turning a batch of
// already-measured differences into short, plain-language explanations a
// non-technical stakeholder can skim. It never decides *whether* something
// differs or *by how much* — those are plain arithmetic in compare.ts.
// If no GEMINI_API_KEY is set, this silently no-ops and the UI falls back
// to the templated `description`/`correction` text already on each issue.

const DEFAULT_MODEL = "gemini-2.5-flash";

function apiKey(): string | null {
  const key = process.env.GEMINI_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

export async function explainIssuesWithAI(issues: Issue[]): Promise<Record<string, string>> {
  const key = apiKey();
  if (!key || issues.length === 0) return {};

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const batch = issues.slice(0, 20); // keep the prompt small and fast

  const prompt = [
    "You are a UX QA assistant. For each detected design-vs-website issue below,",
    "write ONE short, friendly sentence (max 22 words) explaining why it matters",
    "to a user or the brand — not a restatement of the measurement.",
    "Respond ONLY with minified JSON: an array of {\"id\": string, \"explanation\": string}.",
    "",
    JSON.stringify(
      batch.map((i) => ({
        id: i.id,
        category: i.category,
        title: i.title,
        expected: i.expected,
        actual: i.actual,
      }))
    ),
  ].join("\n");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) return {};

    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return {};

    const parsed = JSON.parse(jsonMatch[0]) as { id: string; explanation: string }[];
    const map: Record<string, string> = {};
    for (const item of parsed) {
      if (item.id && item.explanation) map[item.id] = item.explanation.trim();
    }
    return map;
  } catch {
    return {};
  }
}
