"use client";

import { useState } from "react";
import type { Issue, Severity } from "@/lib/types";

const SEVERITY_COLOR: Record<Severity, string> = {
  high: "#E4342A",
  medium: "#C4790A",
  low: "#2F6FED",
};

function issueSpace(issue: Issue): "figma" | "website" {
  return issue.websiteElementId || !issue.figmaElementId ? "website" : "figma";
}

interface ImagePanelProps {
  src?: string;
  label: string;
  issues: Issue[];
  space: "figma" | "website";
  activeIssueId?: string | null;
  onSelectIssue?: (id: string) => void;
  opacity?: number;
  // The coordinate space every issue's boundingBox was measured in. For
  // Figma, this MUST come from the extraction's own frameWidth/frameHeight
  // rather than the rendered <img>'s naturalWidth/naturalHeight — an
  // uploaded SVG's width/height attributes frequently don't match its
  // viewBox (a common Figma export quirk, e.g. a 2x-scale export), and
  // getBBox()-derived element coordinates are always in viewBox units.
  // Using the wrong denominator scaled every box to the wrong position,
  // which on a design with many issues looked like total visual chaos.
  knownWidth?: number;
  knownHeight?: number;
}

function ImagePanel({ src, label, issues, space, activeIssueId, onSelectIssue, opacity, knownWidth, knownHeight }: ImagePanelProps) {
  const [loadedSize, setLoadedSize] = useState<{ w: number; h: number } | null>(null);
  const natural = knownWidth && knownHeight ? { w: knownWidth, h: knownHeight } : loadedSize;
  const relevant = issues.filter((i) => issueSpace(i) === space && i.boundingBox);

  if (!src) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border bg-surface-sunken text-sm text-ink-muted">
        No {label.toLowerCase()} screenshot available
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border bg-white" style={{ opacity }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        className="block w-full"
        onLoad={(e) => {
          if (knownWidth && knownHeight) return; // known coordinate space already set — don't let the image's own rendered size override it
          setLoadedSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
        }}
      />
      {natural &&
        relevant.map((issue) => {
          const box = issue.boundingBox!;
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
                left: `${(box.x / natural.w) * 100}%`,
                top: `${(box.y / natural.h) * 100}%`,
                width: `${(box.width / natural.w) * 100}%`,
                height: `${(box.height / natural.h) * 100}%`,
                border: `${isActive ? 3 : 2}px solid ${color}`,
                backgroundColor: isActive ? `${color}22` : "transparent",
                boxShadow: isActive ? `0 0 0 3px ${color}33` : "none",
                cursor: onSelectIssue ? "pointer" : "default",
              }}
            />
          );
        })}
    </div>
  );
}

type Mode = "side-by-side" | "overlay" | "diff";

export function ScreenshotCompare({
  figmaSrc,
  figmaWidth,
  figmaHeight,
  websiteSrc,
  issues,
  activeIssueId,
  onSelectIssue,
}: {
  figmaSrc?: string;
  figmaWidth?: number;
  figmaHeight?: number;
  websiteSrc?: string;
  issues: Issue[];
  activeIssueId?: string | null;
  onSelectIssue?: (id: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState(50);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-surface-sunken p-1">
          {(
            [
              ["side-by-side", "Side by Side"],
              ["overlay", "Overlay"],
              ["diff", "Difference Highlight"],
            ] as [Mode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === value ? "bg-white text-violet-700 shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "overlay" && (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            Website opacity
            <input
              type="range"
              min={0}
              max={100}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              className="accent-violet-600"
            />
          </label>
        )}
      </div>

      <div className="mt-4">
        {mode === "side-by-side" && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Figma design</p>
              <ImagePanel
                src={figmaSrc}
                label="Figma"
                issues={issues}
                space="figma"
                activeIssueId={activeIssueId}
                onSelectIssue={onSelectIssue}
                knownWidth={figmaWidth}
                knownHeight={figmaHeight}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Live website</p>
              <ImagePanel src={websiteSrc} label="Website" issues={issues} space="website" activeIssueId={activeIssueId} onSelectIssue={onSelectIssue} />
            </div>
          </div>
        )}

        {mode === "overlay" && (
          <div className="relative">
            <p className="mb-2 text-xs text-ink-muted">
              The website screenshot is layered on top of the Figma design at {overlayOpacity}% opacity — misaligned edges reveal spacing/position drift.
            </p>
            <div className="relative">
              <ImagePanel src={figmaSrc} label="Figma" issues={[]} space="figma" knownWidth={figmaWidth} knownHeight={figmaHeight} />
              <div className="absolute inset-0">
                <ImagePanel src={websiteSrc} label="Website" issues={[]} space="website" opacity={overlayOpacity / 100} />
              </div>
            </div>
          </div>
        )}

        {mode === "diff" && (
          <div>
            <p className="mb-2 text-xs text-ink-muted">
              Every detected issue highlighted directly on the live website — red is high priority, orange is medium, blue is low.
            </p>
            <ImagePanel src={websiteSrc} label="Website" issues={issues} space="website" activeIssueId={activeIssueId} onSelectIssue={onSelectIssue} />
          </div>
        )}
      </div>
    </div>
  );
}
