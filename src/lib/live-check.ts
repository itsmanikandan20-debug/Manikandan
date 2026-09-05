async function fetchWithTimeout(url: string, method: "HEAD" | "GET", timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DesignSimilarityFinder/1.0)" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

// "Live" here means the server responded at all (any status under 500) —
// good enough to say the domain is up. It does not confirm the page still
// looks like the matched design; that's the honesty gap the UI badges call out.
export async function checkLive(url: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, "HEAD", 4000);
    if (res.status < 500) return true;
  } catch {
    // Some servers reject HEAD requests — fall through and try GET.
  }
  try {
    const res = await fetchWithTimeout(url, "GET", 4000);
    return res.status < 500;
  } catch {
    return false;
  }
}
