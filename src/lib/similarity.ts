// Small geometry + text-similarity helpers shared by the element matcher
// and the comparison engine. No external dependencies on purpose.

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function normalizeText(s: string | undefined | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Dice's coefficient over character bigrams — a cheap, dependency-free
// fuzzy string similarity that works well for short UI copy ("Get Started"
// vs "Start Now").
export function textSimilarity(a: string | undefined, b: string | undefined): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const bigrams = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };

  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.length === 0 || bb.length === 0) return na === nb ? 1 : 0;

  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);

  let matches = 0;
  for (const g of bb) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      matches += 1;
      counts.set(g, c - 1);
    }
  }

  return clamp01((2 * matches) / (ba.length + bb.length));
}

export function positionDistance(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  scale: number
): number {
  const centerA = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const centerB = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const dx = centerA.x - centerB.x;
  const dy = centerA.y - centerB.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return clamp01(dist / scale);
}

export function sizeSimilarity(
  a: { width: number; height: number },
  b: { width: number; height: number }
): number {
  const areaA = Math.max(1, a.width * a.height);
  const areaB = Math.max(1, b.width * b.height);
  const ratio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
  return clamp01(ratio);
}

export function round(n: number, decimals = 0): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
