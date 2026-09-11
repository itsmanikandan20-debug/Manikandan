import type { DesignElement, ResponsiveFinding, Severity, Viewport } from "./types";
import { captureResponsiveSnapshot } from "./website-analyzer";

// Heuristic checks over the extracted DOM boxes at a given viewport. These
// are intentionally conservative approximations (documented as such in the
// UI) — real pixel-perfect overflow/cutoff detection would need deeper
// browser instrumentation than fits an MVP.

function intersects(a: DesignElement, b: DesignElement): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const overlapArea = (x2 - x1) * (y2 - y1);
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 ? overlapArea / minArea : 0;
}

function contains(a: DesignElement, b: DesignElement): boolean {
  return a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
}

export async function checkResponsiveViewport(url: string, viewport: Viewport): Promise<ResponsiveFinding> {
  const snapshot = await captureResponsiveSnapshot(url, viewport);
  const { elements } = snapshot;
  const issues: ResponsiveFinding["issues"] = [];

  // Overflow: something wider than the viewport (a frequent cause of
  // unwanted horizontal scrolling on phones/tablets).
  const overflowing = elements.filter((el) => el.width > viewport.width + 4 && el.type !== "section");
  for (const el of overflowing.slice(0, 5)) {
    const isNav = /nav|header/i.test(el.section);
    issues.push({
      type: isNav ? "nav-broken" : "overflow",
      severity: isNav ? "high" : el.width - viewport.width > 80 ? "high" : "medium",
      description: `"${el.name}" is ${Math.round(el.width)}px wide, wider than the ${viewport.width}px viewport — likely causing horizontal scrolling.`,
      selector: el.selector,
    });
  }

  // Overlap: two interactive/text elements meaningfully covering each
  // other, excluding normal parent/child nesting.
  const interactive = elements.filter((el) => ["button", "link", "input", "heading", "text"].includes(el.type));
  const overlapsFound = new Set<string>();
  for (let i = 0; i < interactive.length && overlapsFound.size < 4; i++) {
    for (let j = i + 1; j < interactive.length && overlapsFound.size < 4; j++) {
      const a = interactive[i];
      const b = interactive[j];
      if (contains(a, b) || contains(b, a)) continue;
      const overlap = intersects(a, b);
      if (overlap > 0.4) {
        const key = [a.id, b.id].sort().join("-");
        if (overlapsFound.has(key)) continue;
        overlapsFound.add(key);
        issues.push({
          type: "overlap",
          severity: "high",
          description: `"${a.name}" and "${b.name}" visually overlap at this width.`,
          selector: a.selector,
        });
      }
    }
  }

  // Likely text cutoff: rendered box looks too narrow for its own text at
  // this viewport (rough estimate — not a substitute for scrollWidth).
  const textish = elements.filter((el) => (el.type === "heading" || el.type === "text") && el.text && el.fontSize);
  for (const el of textish) {
    const estimatedWidth = (el.text?.length ?? 0) * (el.fontSize ?? 14) * 0.52;
    if (estimatedWidth > el.width * 1.6 && el.height < (el.fontSize ?? 14) * 1.8) {
      issues.push({
        type: "text-cutoff",
        severity: "medium",
        description: `"${el.text?.slice(0, 40)}" likely gets clipped or overlaps neighboring content at this width.`,
        selector: el.selector,
      });
    }
  }

  // Buttons too small to comfortably tap.
  const tinyButtons = elements.filter((el) => el.type === "button" && (el.height < 32 || el.width < 44));
  for (const el of tinyButtons.slice(0, 3)) {
    issues.push({
      type: "button-unusable",
      severity: "medium",
      description: `"${el.name}" is only ${Math.round(el.width)}×${Math.round(el.height)}px — likely too small to tap reliably on a touch screen.`,
      selector: el.selector,
    });
  }

  // Broken images at this viewport.
  for (const src of snapshot.brokenImages.slice(0, 3)) {
    issues.push({
      type: "image-broken",
      severity: "high",
      description: `Image failed to load: ${src}`,
    });
  }

  const severityRank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  if (issues.filter((i) => severityRank[i.severity] >= 2).length >= 4) {
    issues.unshift({
      type: "layout-unusable",
      severity: "high",
      description: `Multiple layout problems detected at ${viewport.width}×${viewport.height} — the page likely isn't usable at this size without fixes.`,
    });
  }

  return {
    viewport,
    screenshotDataUrl: snapshot.screenshotDataUrl,
    issues,
  };
}

export async function checkAllResponsiveViewports(url: string, viewports: Viewport[]): Promise<ResponsiveFinding[]> {
  const results: ResponsiveFinding[] = [];
  for (const vp of viewports) {
    try {
      results.push(await checkResponsiveViewport(url, vp));
    } catch {
      results.push({ viewport: vp, issues: [] });
    }
  }
  return results;
}
