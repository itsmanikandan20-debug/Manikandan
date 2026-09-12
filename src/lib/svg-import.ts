"use client";

import type { DesignElement, ElementType, FigmaExtraction } from "./types";
import { svgToDataUrl } from "./mock-page";

// An alternative to Figma OAuth: a designer exports their frame as an SVG
// (Figma → right-click frame → Export → SVG) and uploads it here. Every
// shape/text layer in the SVG is read directly in the browser — no Figma
// API call, no sign-in, no rate limit, no approval wait. The trade-off is
// real and worth stating plainly: SVG carries no Auto Layout metadata, so
// the spacing/gap checks that need that data simply won't fire for an
// SVG-sourced design (compare.ts already skips them gracefully when those
// fields are undefined) — everything else (text, color, size, position,
// button/heading detection) comes through.
//
// For best results, enable "Include 'id' attribute" in Figma's SVG export
// settings (the gear icon next to the SVG export row) — that carries each
// layer's name into the file, which is what lets this classify elements
// as buttons/headings/icons instead of guessing from shape alone.

export class SvgImportError extends Error {}

const MATCHABLE_TAGS = new Set(["text", "rect", "circle", "ellipse", "image", "path", "polygon", "g"]);

function classify(tag: string, name: string, fontSize: number | undefined, textLength: number): ElementType {
  const n = name.toLowerCase();
  if (tag === "text") {
    if (n.includes("button") || n.includes("cta")) return "button";
    if (fontSize && fontSize >= 28) return "heading";
    if (fontSize && fontSize <= 15 && textLength > 60) return "paragraph";
    return "text";
  }
  if (n.includes("button") || n.includes("cta")) return "button";
  if (n.includes("icon")) return "icon";
  if (n.includes("input") || n.includes("field")) return "input";
  if (tag === "image") return "image";
  if (tag === "g") return "container";
  return "icon"; // bare shape (rect/circle/path/polygon) with no useful name
}

function sanitizeName(id: string | null, fallback: string): string {
  if (!id) return fallback;
  const cleaned = id
    .replace(/^node[-_]?/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return cleaned || fallback;
}

function nearestNamedSection(el: Element, root: Element): string {
  let node: Element | null = el.parentElement;
  while (node && node !== root) {
    const id = node.getAttribute("id");
    if (id && node.tagName.toLowerCase() === "g") return sanitizeName(id, "Design");
    node = node.parentElement;
  }
  return "Design";
}

function rgbOrNamedColor(value: string | null): string | undefined {
  if (!value || value === "none" || value === "transparent") return undefined;
  return value;
}

export function parseSvgToFigmaExtraction(svgText: string, fileName: string): FigmaExtraction {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    throw new SvgImportError("That file doesn't look like a valid SVG. Re-export it from Figma (right-click frame → Export → SVG) and try again.");
  }
  const svgEl = doc.documentElement;
  if (svgEl.tagName.toLowerCase() !== "svg") {
    throw new SvgImportError("That file doesn't look like an SVG.");
  }

  // Mount off-screen so getBBox()/getComputedStyle() resolve real values —
  // an unattached SVG reports zero size for everything.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;visibility:hidden;";
  document.body.appendChild(host);

  try {
    const mounted = document.importNode(svgEl, true) as unknown as SVGSVGElement;
    host.appendChild(mounted);

    const vb = mounted.viewBox?.baseVal;
    const frameWidth = Math.round(vb?.width || mounted.width?.baseVal?.value || 1440) || 1440;
    const frameHeight = Math.round(vb?.height || mounted.height?.baseVal?.value || 900) || 900;
    const frameArea = frameWidth * frameHeight;

    const elements: DesignElement[] = [];
    let counter = 0;
    const nodeList = mounted.querySelectorAll(Array.from(MATCHABLE_TAGS).join(","));

    nodeList.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.getAttribute("id");
      if (tag === "g" && !id) return; // unnamed groups are just structural noise

      let box: DOMRect;
      try {
        box = (el as unknown as SVGGraphicsElement).getBBox();
      } catch {
        return;
      }
      if (!box || box.width < 2 || box.height < 2) return;

      const area = box.width * box.height;
      const isLikelyBackground = tag !== "text" && tag !== "g" && area > frameArea * 0.5;

      const style = window.getComputedStyle(el);
      const text = tag === "text" ? (el.textContent || "").trim() : undefined;
      const fontSize = tag === "text" ? parseFloat(style.fontSize) || undefined : undefined;
      const name = sanitizeName(id, tag);
      const type: ElementType = isLikelyBackground ? "section" : classify(tag, name, fontSize, text?.length ?? 0);

      counter += 1;
      elements.push({
        id: `svg_${counter}`,
        source: "figma",
        type,
        name,
        text: text || undefined,
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        fontFamily: tag === "text" ? style.fontFamily.split(",")[0]?.replace(/["']/g, "").trim() || undefined : undefined,
        fontSize,
        fontWeight: tag === "text" ? style.fontWeight : undefined,
        color: tag === "text" ? rgbOrNamedColor(el.getAttribute("fill") || style.fill) : undefined,
        backgroundColor: tag !== "text" ? rgbOrNamedColor(el.getAttribute("fill") || style.fill) : undefined,
        borderRadius: tag === "rect" ? parseFloat(el.getAttribute("rx") || "0") || undefined : undefined,
        section: nearestNamedSection(el, mounted),
      });
    });

    if (elements.length === 0) {
      throw new SvgImportError(
        "Couldn't find any shapes or text in that SVG. Make sure you exported the actual frame content, not an empty canvas."
      );
    }

    return {
      fileKey: `svg-upload`,
      fileName: fileName.replace(/\.svg$/i, ""),
      pageName: "—",
      frameName: fileName.replace(/\.svg$/i, ""),
      frameWidth,
      frameHeight,
      thumbnailUrl: svgToDataUrl(svgText),
      elements,
      isDemo: false,
    };
  } finally {
    host.remove();
  }
}
