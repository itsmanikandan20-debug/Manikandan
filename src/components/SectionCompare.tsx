"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DesignElement, Issue, MatchedPair, Severity } from "@/lib/types";

const SEVERITY_COLOR: Record<Severity, string> = {
  high: "#E4342A",
  medium: "#C4790A",
  low: "#2F6FED",
};

// An issue's boundingBox is measured in whichever side's coordinate space
// it came from — a figma-space box drawn on the website crop (or vice
// versa) would land in a nonsensical spot, same reasoning as
// ScreenshotCompare's own issueSpace() helper.
function issueSpace(issue: Issue): "figma" | "website" {
  return issue.websiteElementId || !issue.figmaElementId ? "website" : "figma";
}

interface SectionBox {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Groups elements by their existing `.section` label and computes a
// bounding box around each group — the same grouping the matcher itself
// uses server-side, just re-derived here from data already in the saved
// analysis (no new fields needed on AnalysisResult).
function computeSectionBoxes(elements: DesignElement[]): SectionBox[] {
  const groups = new Map<string, DesignElement[]>();
  for (const el of elements) {
    const key = el.section || "Page";
    const list = groups.get(key);
    if (list) list.push(el);
    else groups.set(key, [el]);
  }
  const boxes = Array.from(groups.entries()).map(([name, els]) => {
    const minX = Math.min(...els.map((e) => e.x));
    const minY = Math.min(...els.map((e) => e.y));
    const maxX = Math.max(...els.map((e) => e.x + e.width));
    const maxY = Math.max(...els.map((e) => e.y + e.height));
    return { name, x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  });
  boxes.sort((a, b) => a.y - b.y);
  return boxes;
}

interface PairedSection {
  label: string;
  figma?: SectionBox;
  website?: SectionBox;
}

// Pairs a Figma section to a website section using the same correspondence
// the matcher already settled on — for every matched element pair, look up
// which section each side belongs to, and pair whichever website section
// shows up most often for a given Figma section. This reuses the real
// matching decision instead of re-guessing section names client-side.
function pairSections(
  figmaBoxes: SectionBox[],
  websiteBoxes: SectionBox[],
  matches: MatchedPair[],
  figmaElements: DesignElement[],
  websiteElements: DesignElement[]
): PairedSection[] {
  const figmaById = new Map(figmaElements.map((e) => [e.id, e]));
  const websiteById = new Map(websiteElements.map((e) => [e.id, e]));
  const counts = new Map<string, Map<string, number>>();

  for (const m of matches) {
    if (!m.figmaId || !m.websiteId) continue;
    const f = figmaById.get(m.figmaId);
    const w = websiteById.get(m.websiteId);
    if (!f || !w) continue;
    const fs = f.section || "Page";
    const ws = w.section || "Page";
    const inner = counts.get(fs) ?? new Map<string, number>();
    inner.set(ws, (inner.get(ws) ?? 0) + 1);
    counts.set(fs, inner);
  }

  const figmaToWebsite = new Map<string, string>();
  for (const [fs, inner] of counts) {
    let best: string | null = null;
    let bestCount = 0;
    for (const [ws, c] of inner) {
      if (c > bestCount) {
        best = ws;
        bestCount = c;
      }
    }
    if (best) figmaToWebsite.set(fs, best);
  }

  const usedWebsite = new Set(figmaToWebsite.values());
  const result: PairedSection[] = figmaBoxes.map((fb) => {
    const wsName = figmaToWebsite.get(fb.name);
    const wb = wsName ? websiteBoxes.find((b) => b.name === wsName) : undefined;
    return { label: fb.name, figma: fb, website: wb };
  });
  for (const wb of websiteBoxes) {
    if (usedWebsite.has(wb.name)) continue;
    result.push({ label: wb.name, website: wb });
  }
  return result;
}

interface CropPanelProps {
  src?: string;
  box?: SectionBox;
  label: string;
  issues: Issue[];
  activeIssueId?: string | null;
  onSelectIssue?: (id: string) => void;
  knownWidth?: number;
  knownHeight?: number;
}

// Crops the full screenshot down to just this section's region by
// rendering the whole image at its true pixel size inside an
// overflow-hidden box shaped to the section's own aspect ratio, then
// shifting it so the section's top-left lands at the box's origin — a
// ResizeObserver supplies the real rendered pixel width so the math stays
// exact at any screen size, not just a fixed layout width.
function CropPanel({ src, box, label, issues, activeIssueId, onSelectIssue, knownWidth, knownHeight }: CropPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loadedSize, setLoadedSize] = useState<{ w: number; h: number } | null>(null);
  const naturalWidth = knownWidth ?? loadedSize?.w;
  const naturalHeight = knownHeight ?? loadedSize?.h;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!src || !box) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border bg-surface-sunken text-sm text-ink-muted">
        No {label.toLowerCase()} section here
      </div>
    );
  }

  const scale = containerWidth > 0 ? containerWidth / box.width : 0;
  const relevant = issues.filter((i) => i.boundingBox);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl border border-border bg-white"
      style={{ aspectRatio: `${box.width} / ${box.height}` }}
    >
      {scale > 0 && naturalWidth && naturalHeight && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={label}
            onLoad={(e) => {
              if (knownWidth && knownHeight) return;
              setLoadedSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
            }}
            style={{
              position: "absolute",
              maxWidth: "none",
              width: naturalWidth * scale,
              left: -box.x * scale,
              top: -box.y * scale,
            }}
          />
          {relevant.map((issue) => {
            const ibox = issue.boundingBox!;
            const isActive = issue.id === activeIssueId;
            const color = SEVERITY_COLOR[issue.severity];
            return (
              <button
                key={issue.id}
                type="button"
                title={`Issue #${issue.number} — ${issue.title}`}
                onClick={() => onSelectIssue?.(issue.id)}
                className="absolute rounded-[3px] transition-all"
                style={{
                  left: (ibox.x - box.x) * scale,
                  top: (ibox.y - box.y) * scale,
                  width: ibox.width * scale,
                  height: ibox.height * scale,
                  border: `${isActive ? 3 : 2}px solid ${color}`,
                  backgroundColor: isActive ? `${color}22` : "transparent",
                  boxShadow: isActive ? `0 0 0 3px ${color}33` : "none",
                  cursor: onSelectIssue ? "pointer" : "default",
                }}
              />
            );
          })}
        </>
      )}
      {/* Image hasn't reported its natural size yet on first mount */}
      {!(naturalWidth && naturalHeight) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="hidden"
          onLoad={(e) => setLoadedSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      )}
    </div>
  );
}

export function SectionCompare({
  figmaSrc,
  figmaWidth,
  figmaHeight,
  figmaElements,
  websiteSrc,
  websiteElements,
  matches,
  issues,
  activeIssueId,
  onSelectIssue,
}: {
  figmaSrc?: string;
  figmaWidth?: number;
  figmaHeight?: number;
  figmaElements: DesignElement[];
  websiteSrc?: string;
  websiteElements: DesignElement[];
  matches: MatchedPair[];
  issues: Issue[];
  activeIssueId?: string | null;
  onSelectIssue?: (id: string) => void;
}) {
  const sections = useMemo(() => {
    const figmaBoxes = computeSectionBoxes(figmaElements);
    const websiteBoxes = computeSectionBoxes(websiteElements);
    return pairSections(figmaBoxes, websiteBoxes, matches, figmaElements, websiteElements);
  }, [figmaElements, websiteElements, matches]);

  const [index, setIndex] = useState(0);
  const clampedIndex = Math.min(index, Math.max(0, sections.length - 1));
  const current = sections[clampedIndex];

  if (sections.length === 0) {
    return <p className="text-sm text-ink-muted">No sections could be identified in this analysis.</p>;
  }

  const sectionIssues = issues.filter(
    (i) => i.section === current.figma?.name || i.section === current.website?.name || i.section === current.label
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={clampedIndex === 0}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-ink">{current.label}</p>
          <p className="text-xs text-ink-muted">
            Section {clampedIndex + 1} of {sections.length}
            {sectionIssues.length > 0 && ` · ${sectionIssues.length} issue${sectionIssues.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          onClick={() => setIndex((i) => Math.min(sections.length - 1, i + 1))}
          disabled={clampedIndex === sections.length - 1}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={sections.length - 1}
        value={clampedIndex}
        onChange={(e) => setIndex(Number(e.target.value))}
        className="mt-3 w-full accent-violet-600"
      />
      <div className="mt-1 flex justify-between text-[10px] text-ink-muted">
        <span>{sections[0].label}</span>
        <span>{sections[sections.length - 1].label}</span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Figma design</p>
          <CropPanel
            src={figmaSrc}
            box={current.figma}
            label="Figma"
            issues={sectionIssues.filter((i) => issueSpace(i) === "figma")}
            activeIssueId={activeIssueId}
            onSelectIssue={onSelectIssue}
            knownWidth={figmaWidth}
            knownHeight={figmaHeight}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Live website</p>
          <CropPanel
            src={websiteSrc}
            box={current.website}
            label="Website"
            issues={sectionIssues.filter((i) => issueSpace(i) === "website")}
            activeIssueId={activeIssueId}
            onSelectIssue={onSelectIssue}
          />
        </div>
      </div>
    </div>
  );
}
