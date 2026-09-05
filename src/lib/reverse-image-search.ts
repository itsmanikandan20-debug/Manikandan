export interface RawVisualMatch {
  title: string;
  link: string | null;
  source: string | null;
  thumbnail: string | null;
}

export async function findVisualMatches(imageUrl: string): Promise<RawVisualMatch[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("SERPAPI_API_KEY is not set");

  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    api_key: apiKey,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      signal: controller.signal,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(typeof json?.error === "string" ? json.error : `SerpApi request failed (${res.status})`);
    }

    const matches: unknown[] = Array.isArray(json.visual_matches) ? json.visual_matches : [];
    return matches.slice(0, 8).map((raw) => {
      const match = raw as Record<string, unknown>;
      const link = typeof match.link === "string" ? match.link : null;
      return {
        title: typeof match.title === "string" ? match.title : "Untitled match",
        link,
        source: typeof match.source === "string" ? match.source : safeHostname(link),
        thumbnail: typeof match.thumbnail === "string" ? match.thumbnail : null,
      };
    });
  } finally {
    clearTimeout(timeout);
  }
}

function safeHostname(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
