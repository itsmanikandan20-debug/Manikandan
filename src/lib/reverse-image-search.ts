export interface RawVisualMatch {
  title: string;
  link: string | null;
  source: string | null;
  thumbnail: string | null;
}

// A screenshot of a real live site is often reposted on design-inspiration
// / social platforms (people showcasing it), and those reposts can outrank
// the actual site in Google's visual-match ranking. Since the product's
// whole point is surfacing the real live website, matches from these
// domains are sorted after everything else rather than excluded outright —
// they're still shown if nothing better exists.
const AGGREGATOR_DOMAINS = [
  "pinterest.",
  "pinimg.com",
  "behance.net",
  "dribbble.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "tumblr.com",
  "freepik.com",
  "uplabs.com",
];

function isAggregatorDomain(hostname: string | null): boolean {
  if (!hostname) return false;
  return AGGREGATOR_DOMAINS.some((domain) => hostname.includes(domain));
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

    const rawMatches: unknown[] = Array.isArray(json.visual_matches) ? json.visual_matches : [];
    const parsed = rawMatches.slice(0, 20).map((raw) => {
      const match = raw as Record<string, unknown>;
      const link = typeof match.link === "string" ? match.link : null;
      const hostname = safeHostname(link);
      return {
        title: typeof match.title === "string" ? match.title : "Untitled match",
        link,
        source: typeof match.source === "string" ? match.source : hostname,
        thumbnail: typeof match.thumbnail === "string" ? match.thumbnail : null,
        isAggregator: isAggregatorDomain(hostname),
      };
    });

    // Stable-sort: real-site matches first, aggregator/portfolio reposts
    // pushed after, without losing Google's relevance order within each group.
    const sorted = [...parsed].sort((a, b) => Number(a.isAggregator) - Number(b.isAggregator));

    return sorted.slice(0, 8).map(({ title, link, source, thumbnail }) => ({ title, link, source, thumbnail }));
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
