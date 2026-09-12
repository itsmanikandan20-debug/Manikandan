import type { DesignElement, ElementType, FigmaExtraction } from "./types";
import { makeId } from "./id";

const FIGMA_API = "https://api.figma.com/v1";

export class FigmaApiError extends Error {}

export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string | null } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FigmaApiError("That doesn't look like a valid URL. Copy the full link from Figma's Share button.");
  }
  if (!/figma\.com$/.test(parsed.hostname.replace(/^www\./, ""))) {
    throw new FigmaApiError("That URL isn't a figma.com link. Copy it from Figma's Share button.");
  }
  // Figma links look like /file/<key>/<name> or /design/<key>/<name>
  const match = parsed.pathname.match(/\/(file|design|proto)\/([a-zA-Z0-9]+)/);
  if (!match) {
    throw new FigmaApiError("Couldn't find a file key in that Figma URL.");
  }
  const fileKey = match[2];
  const rawNodeId = parsed.searchParams.get("node-id");
  const nodeId = rawNodeId ? rawNodeId.replace(/-/g, ":") : null;
  return { fileKey, nodeId };
}

// --- Figma REST API response shapes (only the fields we use) ----------------

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}
interface FigmaGradientStop {
  color: FigmaColor;
  position: number;
}
interface FigmaPaint {
  type: string;
  color?: FigmaColor;
  visible?: boolean;
  opacity?: number;
  gradientStops?: FigmaGradientStop[];
}
interface FigmaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface FigmaTextStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
}
interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  absoluteBoundingBox?: FigmaRect;
  characters?: string;
  style?: FigmaTextStyle;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  cornerRadius?: number;
  opacity?: number;
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  children?: FigmaNode[];
}
interface FigmaFileResponse {
  name: string;
  document: FigmaNode;
}
interface FigmaNodesResponse {
  name: string;
  nodes: Record<string, { document: FigmaNode } | null>;
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return `about ${Math.round(seconds)} seconds`;
  const minutes = seconds / 60;
  if (minutes < 90) return `about ${Math.round(minutes)} minutes`;
  const hours = minutes / 60;
  if (hours < 36) return `about ${Math.round(hours)} hours`;
  return `about ${Math.round(hours / 24)} days`;
}

async function figmaFetch<T>(path: string, token: string): Promise<T> {
  // OAuth access tokens (what every designer's session holds) go in a
  // Bearer Authorization header — "X-Figma-Token" is only for the older
  // personal-access-token scheme, which we no longer use anywhere.
  const res = await fetch(`${FIGMA_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 403 || res.status === 401) {
    throw new FigmaApiError("Your Figma connection was rejected or has expired. Please reconnect your Figma account and try again.");
  }
  if (res.status === 404) {
    throw new FigmaApiError("Figma file not found. Make sure the link is correct and the file is shared with your account.");
  }
  if (res.status === 429) {
    const retryAfterSeconds = Number(res.headers.get("Retry-After"));
    const wait = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? formatDuration(retryAfterSeconds) : "a minute or two";

    // A short wait (seconds/minutes) is normal, ordinary rate-limiting.
    // A wait measured in hours/days is a different, much stricter quota —
    // the kind Figma applies to apps still in "Draft" (unpublished)
    // status, specifically to discourage using dev credentials for real
    // usage. If you're seeing this, publishing the app (Figma app →
    // Publish → set Audience to Public) is the real fix, not waiting.
    const draftHint =
      retryAfterSeconds > 3600
        ? " This unusually long wait usually means your Figma app is still in Draft/unpublished status, which has a much stricter quota — publishing the app (with Audience set to Public) should fix this permanently."
        : "";

    throw new FigmaApiError(
      `Figma is temporarily rate-limiting requests to this file. Please wait ${wait} and try again.${draftHint}`
    );
  }
  if (!res.ok) {
    throw new FigmaApiError(`Figma API error (${res.status}). Please try again in a moment.`);
  }
  return res.json() as Promise<T>;
}

function colorToHex(c: FigmaColor | undefined): string | undefined {
  if (!c) return undefined;
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`.toUpperCase();
}

function firstSolidFill(paints: FigmaPaint[] | undefined): string | undefined {
  const solid = (paints ?? []).find((p) => p.type === "SOLID" && p.visible !== false);
  return solid ? colorToHex(solid.color) : undefined;
}

function firstGradientStops(paints: FigmaPaint[] | undefined): string[] | undefined {
  const gradient = (paints ?? []).find((p) => p.type.startsWith("GRADIENT_") && p.visible !== false);
  if (!gradient?.gradientStops?.length) return undefined;
  const stops = gradient.gradientStops.map((s) => colorToHex(s.color)).filter((c): c is string => Boolean(c));
  return stops.length > 0 ? stops : undefined;
}

function classifyType(node: FigmaNode): ElementType {
  const name = node.name.toLowerCase();
  if (node.type === "TEXT") {
    const size = node.style?.fontSize ?? 14;
    if (name.includes("button") || name.includes("cta")) return "button";
    if (size >= 28) return "heading";
    if (size <= 15 && node.characters && node.characters.length > 60) return "paragraph";
    return "text";
  }
  if (name.includes("button") || name.includes("cta")) return "button";
  if (name.includes("icon")) return "icon";
  if (name.includes("input") || name.includes("field")) return "input";
  if (node.type === "COMPONENT" || node.type === "INSTANCE") return "component";
  if (node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "VECTOR") {
    const hasImageFill = (node.fills ?? []).some((p) => p.type === "IMAGE");
    return hasImageFill ? "image" : "icon";
  }
  if (node.type === "FRAME" || node.type === "GROUP") {
    if (node.layoutMode && node.layoutMode !== "NONE") return "container";
    return "section";
  }
  return "container";
}

function isSectionLike(node: FigmaNode): boolean {
  return (node.type === "FRAME" || node.type === "GROUP") && Boolean(node.absoluteBoundingBox);
}

/**
 * Walks the Figma node tree under `root`, producing a flat list of
 * normalized DesignElements. Top-level children of the target frame
 * become "sections" (Header, Hero, Footer, ...); everything nested under
 * them is tagged with that section name so the comparison engine can
 * group and compare spacing/gap per section.
 */
function extractElements(root: FigmaNode, frameOrigin: { x: number; y: number }): DesignElement[] {
  const out: DesignElement[] = [];

  const walk = (node: FigmaNode, section: string, depth: number) => {
    if (node.visible === false) return;
    const box = node.absoluteBoundingBox;

    if (depth > 0 && box) {
      const type = classifyType(node);
      const isContainerType = type === "section" || type === "container";

      // Only emit containers when they carry auto-layout info worth
      // comparing (padding/gap) — deeply nested plain groups are just
      // structural noise.
      const shouldEmit = !isContainerType || node.layoutMode !== undefined;

      if (shouldEmit) {
        out.push({
          id: makeId("figma"),
          source: "figma",
          type,
          name: node.name,
          text: node.type === "TEXT" ? node.characters : undefined,
          x: box.x - frameOrigin.x,
          y: box.y - frameOrigin.y,
          width: box.width,
          height: box.height,
          fontFamily: node.style?.fontFamily,
          fontSize: node.style?.fontSize,
          fontWeight: node.style?.fontWeight,
          color: node.type === "TEXT" ? firstSolidFill(node.fills) : undefined,
          backgroundColor: node.type !== "TEXT" ? firstSolidFill(node.fills) : undefined,
          gradientStops: firstGradientStops(node.fills),
          borderRadius: node.cornerRadius,
          paddingTop: node.paddingTop,
          paddingRight: node.paddingRight,
          paddingBottom: node.paddingBottom,
          paddingLeft: node.paddingLeft,
          gap: node.itemSpacing,
          opacity: node.opacity,
          autoLayout: node.layoutMode === "HORIZONTAL" ? "horizontal" : node.layoutMode === "VERTICAL" ? "vertical" : "none",
          section,
        });
      }
    }

    const nextSection = depth === 0 && isSectionLike(node) ? node.name : section;
    for (const child of node.children ?? []) {
      walk(child, depth === 0 ? node.name : nextSection, depth + 1);
    }
  };

  for (const child of root.children ?? []) {
    walk(child, child.name, 0);
  }

  return out;
}

async function findTargetFrame(document: FigmaNode, nodeId: string | null): Promise<FigmaNode> {
  if (nodeId) {
    const found = findNodeById(document, nodeId);
    if (found) return found;
  }
  // Fall back to the first page's first top-level frame.
  const firstPage = document.children?.[0];
  const firstFrame = firstPage?.children?.find((n) => n.type === "FRAME");
  if (firstFrame) return firstFrame;
  if (firstPage) return firstPage;
  throw new FigmaApiError("Couldn't find a frame to analyze in this Figma file. Select a specific frame and copy its link (right-click → Copy link to selection).");
}

function findNodeById(node: FigmaNode, id: string): FigmaNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

export async function fetchFigmaExtraction(figmaUrl: string, token: string): Promise<FigmaExtraction> {
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);

  // Figma's rate limits are cost-based, and GET /files/:key — which reads
  // the ENTIRE file (every page, frame, and layer) — is by far the most
  // expensive call available. When the link already points at a specific
  // frame (Figma → right-click → "Copy link to selection" includes a
  // node-id), GET /files/:key/nodes fetches only that frame's subtree,
  // which is dramatically cheaper and exactly what we need. The full-file
  // fetch is now only a fallback for a bare file link with no frame
  // selected.
  let fileName: string;
  let frame: FigmaNode;
  if (nodeId) {
    const data = await figmaFetch<FigmaNodesResponse>(
      `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
      token
    );
    fileName = data.name;
    const found = data.nodes[nodeId]?.document;
    if (!found) {
      throw new FigmaApiError(
        "Couldn't find that frame in the file — the link may be stale. Re-select the frame in Figma and copy its link again."
      );
    }
    frame = found;
  } else {
    const file = await figmaFetch<FigmaFileResponse>(`/files/${fileKey}`, token);
    fileName = file.name;
    frame = await findTargetFrame(file.document, null);
  }

  const box = frame.absoluteBoundingBox ?? { x: 0, y: 0, width: 1440, height: 900 };

  const elements = extractElements(frame, { x: box.x, y: box.y });

  let thumbnailUrl: string | undefined;
  try {
    const images = await figmaFetch<{ images: Record<string, string> }>(
      `/images/${fileKey}?ids=${encodeURIComponent(frame.id)}&format=png&scale=1`,
      token
    );
    thumbnailUrl = images.images?.[frame.id] ?? undefined;
  } catch {
    // Non-fatal — the UI just won't show a Figma screenshot.
  }

  return {
    fileKey,
    fileName,
    pageName: "—",
    frameName: frame.name,
    frameWidth: Math.round(box.width),
    frameHeight: Math.round(box.height),
    thumbnailUrl,
    elements,
    isDemo: false,
  };
}
