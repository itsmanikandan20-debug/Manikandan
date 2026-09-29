// Design Agent Figma plugin (main code). Runs inside Figma with access to the open file.
// - Describes what you're looking at (selection, or the frames in view) for the AI:
//   layers with ids, text, fonts, colours, sizes, auto-layout spacing, components, styles.
// - Draws Design Agent's own orange pointer on the canvas (a temporary, locked layer).
// It does NOT change your design. Changes come in a later step, and only after you approve.

figma.showUI(__html__, { width: 260, height: 104, title: "Design Agent" });

const ORANGE = { r: 0.949, g: 0.337, b: 0.114 };
const WHITE = { r: 1, g: 1, b: 1 };
const POINTER_TAG = "pointer";
const MAX_NODES = 220;
const MAX_DEPTH = 8;

// ---------- small helpers ----------
const round = (n) => Math.round(n * 10) / 10;
function hex(c) {
  return "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}
function luminance(c) {
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function isPointer(node) {
  try {
    return node.getPluginData("designAgent") === POINTER_TAG;
  } catch (e) {
    return false;
  }
}
function firstSolid(paints) {
  if (!paints || paints === figma.mixed || !paints.length) return null;
  for (const p of paints) if (p.visible !== false && p.type === "SOLID") return p;
  return null;
}
function describePaints(paints) {
  if (!paints || paints === figma.mixed) return "mixed";
  const visible = paints.filter((p) => p.visible !== false);
  if (!visible.length) return "";
  return visible
    .map((p) => {
      if (p.type === "SOLID") return hex(p.color) + (p.opacity !== undefined && p.opacity < 1 ? ` ${Math.round(p.opacity * 100)}%` : "");
      if (p.type === "IMAGE") return "image";
      return p.type.toLowerCase().replace("_", "-");
    })
    .join(" + ");
}

const nameCache = new Map();
async function styleName(id) {
  if (!id || id === figma.mixed) return "";
  if (nameCache.has(id)) return nameCache.get(id);
  let name = "";
  try {
    const style = await figma.getStyleByIdAsync(id);
    name = style ? style.name : "";
  } catch (e) {
    name = "";
  }
  nameCache.set(id, name);
  return name;
}
async function variableName(alias) {
  if (!alias || !alias.id) return "";
  if (nameCache.has(alias.id)) return nameCache.get(alias.id);
  let name = "";
  try {
    const variable = await figma.variables.getVariableByIdAsync(alias.id);
    name = variable ? variable.name : "";
  } catch (e) {
    name = "";
  }
  nameCache.set(alias.id, name);
  return name;
}

/** The nearest solid fill behind a node (for text contrast). */
function backgroundBehind(node) {
  for (let p = node.parent; p && p.type !== "PAGE" && p.type !== "DOCUMENT"; p = p.parent) {
    const fill = "fills" in p ? firstSolid(p.fills) : null;
    if (fill) return fill.color;
  }
  return WHITE;
}

// ---------- describing the design ----------
async function describeNode(node, origin, lines, state, depth, prevBottom) {
  if (state.count >= MAX_NODES || node.visible === false || isPointer(node)) return null;
  const box = node.absoluteBoundingBox;
  if (!box) return null;
  state.count++;

  const parts = [node.id, node.type.toLowerCase(), JSON.stringify(node.name.length > 60 ? node.name.slice(0, 57) + "..." : node.name)];
  parts.push(`x${round(box.x - origin.x)} y${round(box.y - origin.y)} ${round(box.width)}x${round(box.height)}`);
  if (prevBottom !== null && prevBottom !== undefined && box.y >= prevBottom) parts.push(`gapAbove ${round(box.y - prevBottom)}`);

  if (node.type === "TEXT") {
    const text = node.characters.replace(/\s+/g, " ").trim();
    parts.push(JSON.stringify(text.length > 90 ? text.slice(0, 87) + "..." : text));
    if (node.fontName === figma.mixed) parts.push("font mixed");
    else parts.push(`font "${node.fontName.family}" ${node.fontName.style}`);
    if (node.fontSize !== figma.mixed) parts.push(`${round(node.fontSize)}px`);
    const lh = node.lineHeight;
    if (lh && lh !== figma.mixed && lh.unit !== "AUTO") parts.push(`lh ${round(lh.value)}${lh.unit === "PERCENT" ? "%" : "px"}`);
    const ls = node.letterSpacing;
    if (ls && ls !== figma.mixed && ls.value) parts.push(`ls ${round(ls.value)}${ls.unit === "PERCENT" ? "%" : "px"}`);
    if (node.textCase && node.textCase !== figma.mixed && node.textCase !== "ORIGINAL") parts.push(node.textCase.toLowerCase());
    const textStyle = await styleName(node.textStyleId);
    if (textStyle) parts.push(`textStyle "${textStyle}"`);
    const color = firstSolid(node.fills);
    if (color) {
      const back = backgroundBehind(node);
      const ratio = contrast(color.color, back);
      const size = node.fontSize === figma.mixed ? 16 : node.fontSize;
      parts.push(`color ${hex(color.color)} on ${hex(back)} contrast ${ratio.toFixed(1)}${ratio < 4.5 && size < 24 ? " LOW" : ""}`);
    }
  } else if ("fills" in node) {
    const fills = describePaints(node.fills);
    if (fills) parts.push(`fill ${fills}`);
  }

  if ("fills" in node && node.boundVariables && node.boundVariables.fills) {
    const names = [];
    for (const alias of node.boundVariables.fills) names.push(await variableName(alias));
    if (names.some(Boolean)) parts.push(`fillVariable "${names.filter(Boolean).join(", ")}"`);
  } else if ("fillStyleId" in node && node.type !== "TEXT") {
    const fillStyle = await styleName(node.fillStyleId);
    if (fillStyle) parts.push(`fillStyle "${fillStyle}"`);
  }

  if ("strokes" in node && node.strokes && node.strokes.length) {
    const weight = node.strokeWeight === figma.mixed ? "mixed" : round(node.strokeWeight);
    parts.push(`stroke ${describePaints(node.strokes)} ${weight}px`);
  }
  if ("cornerRadius" in node && node.cornerRadius) parts.push(`radius ${node.cornerRadius === figma.mixed ? "mixed" : round(node.cornerRadius)}`);
  if ("effects" in node && node.effects && node.effects.length) {
    const effects = node.effects.filter((e) => e.visible !== false).map((e) => e.type.toLowerCase().replace("_", "-"));
    if (effects.length) parts.push(`effects ${effects.join(",")}`);
  }
  if ("opacity" in node && node.opacity < 1) parts.push(`opacity ${Math.round(node.opacity * 100)}%`);

  if ("layoutMode" in node && node.layoutMode && node.layoutMode !== "NONE") {
    const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map(round).join(" ");
    parts.push(
      `autoLayout ${node.layoutMode.toLowerCase()} gap ${node.primaryAxisAlignItems === "SPACE_BETWEEN" ? "auto(space-between)" : round(node.itemSpacing)} padding ${pad}` +
        ` align ${String(node.primaryAxisAlignItems).toLowerCase()}/${String(node.counterAxisAlignItems).toLowerCase()}` +
        (node.layoutWrap === "WRAP" ? " wrap" : ""),
    );
  }
  if ("layoutSizingHorizontal" in node && node.parent && "layoutMode" in node.parent && node.parent.layoutMode && node.parent.layoutMode !== "NONE") {
    parts.push(`sizing ${String(node.layoutSizingHorizontal).toLowerCase()}/${String(node.layoutSizingVertical).toLowerCase()}`);
  }

  if (node.type === "INSTANCE") {
    try {
      const main = await node.getMainComponentAsync();
      if (main) parts.push(`instanceOf "${main.parent && main.parent.type === "COMPONENT_SET" ? main.parent.name + " / " : ""}${main.name}"${main.remote ? " (library)" : ""}`);
    } catch (e) {
      // ignore
    }
  }
  if (node.type === "COMPONENT") parts.push("mainComponent");

  lines.push("  ".repeat(depth) + parts.join(" | "));

  // Children: in auto-layout the spacing is known; otherwise report gaps top-to-bottom.
  if ("children" in node && depth < MAX_DEPTH && node.type !== "INSTANCE" || (node.type === "INSTANCE" && depth < 3)) {
    const auto = "layoutMode" in node && node.layoutMode && node.layoutMode !== "NONE";
    const kids = node.children.filter((c) => c.visible !== false && c.absoluteBoundingBox);
    const ordered = auto ? kids : kids.slice().sort((a, b) => a.absoluteBoundingBox.y - b.absoluteBoundingBox.y);
    let bottom = null;
    for (const child of ordered) {
      if (state.count >= MAX_NODES) {
        lines.push("  ".repeat(depth + 1) + "… (more layers not listed)");
        break;
      }
      await describeNode(child, origin, lines, state, depth + 1, auto ? null : bottom);
      const b = child.absoluteBoundingBox;
      bottom = bottom === null ? b.y + b.height : Math.max(bottom, b.y + b.height);
    }
  }
  return node;
}

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** What the user is looking at: their selection, or the frames visible on screen. */
function currentRoots() {
  const selection = figma.currentPage.selection.filter((n) => !isPointer(n));
  if (selection.length) return { roots: selection.slice(0, 4), how: `their selection (${selection.length} layer${selection.length > 1 ? "s" : ""})` };
  const view = figma.viewport.bounds;
  const inView = figma.currentPage.children
    .filter((n) => n.visible !== false && !isPointer(n) && n.absoluteBoundingBox && intersects(n.absoluteBoundingBox, view))
    .map((n) => {
      const b = n.absoluteBoundingBox;
      const w = Math.min(b.x + b.width, view.x + view.width) - Math.max(b.x, view.x);
      const h = Math.min(b.y + b.height, view.y + view.height) - Math.max(b.y, view.y);
      return { n, area: w * h };
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, 2)
    .map((x) => x.n);
  return { roots: inView, how: inView.length ? "the frames visible on screen (nothing selected)" : "nothing (the view is empty)" };
}

async function snapshot() {
  const { roots, how } = currentRoots();
  const lines = [];
  const state = { count: 0 };
  for (const root of roots) {
    const origin = root.absoluteBoundingBox || { x: 0, y: 0 };
    lines.push(`\nRoot "${root.name}" (${root.type.toLowerCase()}, id ${root.id}); positions below are relative to it:`);
    await describeNode(root, origin, lines, state, 0, null);
  }

  let styles = "";
  try {
    const [text, paint, collections] = await Promise.all([
      figma.getLocalTextStylesAsync(),
      figma.getLocalPaintStylesAsync(),
      figma.variables.getLocalVariableCollectionsAsync(),
    ]);
    styles = `Local styles: ${text.length} text, ${paint.length} colour. Variable collections: ${collections.map((c) => c.name).join(", ") || "none"}.`;
  } catch (e) {
    styles = "";
  }

  // A picture of the main thing being looked at.
  let screenshot = null;
  const main = roots[0];
  if (main && main.absoluteBoundingBox) {
    try {
      const b = main.absoluteBoundingBox;
      const scale = Math.max(0.05, Math.min(2, 1400 / Math.max(b.width, b.height)));
      const bytes = await main.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: scale } });
      screenshot = figma.base64Encode(bytes);
    } catch (e) {
      screenshot = null;
    }
  }

  const text =
    `Figma file: "${figma.root.name}", page: "${figma.currentPage.name}"\n` +
    `Looking at: ${how}\n` +
    (styles ? styles + "\n" : "") +
    `Layers (id | type | "name" | x,y and size in px | details). Indentation shows nesting:` +
    lines.join("\n");
  return { text, count: state.count, file: figma.root.name, screenshot };
}

// ---------- the pointer ----------
let pointerNode = null;

function removePointer() {
  try {
    if (pointerNode && !pointerNode.removed) pointerNode.remove();
  } catch (e) {
    // already gone
  }
  pointerNode = null;
  // Also clean up any pointer left behind by an earlier session.
  for (const n of figma.currentPage.children) if (isPointer(n)) n.remove();
}

let labelFont = null;
async function ensureLabelFont() {
  if (labelFont !== null) return labelFont;
  for (const font of [{ family: "Inter", style: "Semi Bold" }, { family: "Inter", style: "Medium" }, { family: "Inter", style: "Regular" }]) {
    try {
      await figma.loadFontAsync(font);
      labelFont = font;
      return font;
    } catch (e) {
      // try the next one
    }
  }
  labelFont = false;
  return false;
}

/** Points at a layer id like "12:34", or at the gap between two layers with "12:34-12:40". */
async function point(target) {
  const ids = String(target).split("-").map((s) => s.trim()).filter(Boolean);
  const a = await figma.getNodeByIdAsync(ids[0]);
  const b = ids[1] ? await figma.getNodeByIdAsync(ids[1]) : null;
  if (!a || !a.absoluteBoundingBox) return { ok: false, reason: `layer ${ids[0]} not found` };

  let area;
  const A = a.absoluteBoundingBox;
  let gap = false;
  if (b && b.absoluteBoundingBox) {
    const B = b.absoluteBoundingBox;
    const upper = A.y <= B.y ? A : B;
    const lower = A.y <= B.y ? B : A;
    const left = Math.min(upper.x, lower.x);
    const right = Math.max(upper.x + upper.width, lower.x + lower.width);
    area = { x: left, y: upper.y + upper.height, width: right - left, height: Math.max(lower.y - (upper.y + upper.height), 2) };
    gap = true;
  } else {
    area = { x: A.x, y: A.y, width: A.width, height: A.height };
  }

  removePointer();
  const k = 1 / figma.viewport.zoom; // keep the pointer the same size on screen at any zoom
  const pad = gap ? 0 : 4 * k;

  const box = figma.createRectangle();
  box.name = "highlight";
  box.x = area.x - pad;
  box.y = area.y - pad;
  box.resize(Math.max(area.width + pad * 2, 1), Math.max(area.height + pad * 2, 1));
  box.fills = [{ type: "SOLID", color: ORANGE, opacity: 0.1 }];
  box.strokes = [{ type: "SOLID", color: ORANGE }];
  box.strokeWeight = 2 * k;
  box.cornerRadius = gap ? 2 * k : 6 * k;
  if (gap) box.dashPattern = [6 * k, 4 * k];

  const tipX = area.x + Math.min(area.width * 0.55, area.width - 10 * k);
  const tipY = area.y + area.height - (gap ? area.height / 2 : 6 * k);
  const arrow = figma.createVector();
  arrow.name = "arrow";
  const pts = [[0, 0], [0, 22], [6, 16.5], [10.5, 26], [14.5, 24.2], [10, 15], [18, 15]];
  arrow.vectorPaths = [{ windingRule: "NONZERO", data: "M " + pts.map(([x, y]) => `${round(x * k)} ${round(y * k)}`).join(" L ") + " Z" }];
  arrow.x = tipX;
  arrow.y = tipY;
  arrow.fills = [{ type: "SOLID", color: ORANGE }];
  arrow.strokes = [{ type: "SOLID", color: WHITE }];
  arrow.strokeWeight = 1.5 * k;

  const nodes = [box, arrow];
  const font = await ensureLabelFont();
  if (font) {
    const tag = figma.createFrame();
    tag.name = "label";
    tag.layoutMode = "HORIZONTAL";
    tag.primaryAxisSizingMode = "AUTO";
    tag.counterAxisSizingMode = "AUTO";
    tag.paddingLeft = tag.paddingRight = 9 * k;
    tag.paddingTop = tag.paddingBottom = 5 * k;
    tag.cornerRadius = 999;
    tag.fills = [{ type: "SOLID", color: ORANGE }];
    const label = figma.createText();
    label.fontName = font;
    label.fontSize = 12 * k;
    label.characters = "Design Agent";
    label.fills = [{ type: "SOLID", color: WHITE }];
    tag.appendChild(label);
    tag.x = tipX + 14 * k;
    tag.y = tipY + 22 * k;
    nodes.push(tag);
  }

  const group = figma.group(nodes, figma.currentPage);
  group.name = "Design Agent pointer (temporary)";
  group.setPluginData("designAgent", POINTER_TAG);
  group.locked = true;
  pointerNode = group;

  // Bring it into view if it's off screen (keeps your zoom level).
  const view = figma.viewport.bounds;
  if (!intersects(area, view)) figma.viewport.center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  return { ok: true };
}

// ---------- talking to Design Agent (through the plugin window) ----------
async function runTool(tool, args) {
  if (tool === "figma.snapshot") return snapshot();
  if (tool === "figma.point") return point(args.target);
  if (tool === "figma.hide") {
    removePointer();
    return { ok: true };
  }
  throw new Error(`unknown tool ${tool}`);
}

figma.ui.onmessage = async (message) => {
  if (message.type === "connected") {
    reportActivity();
    return;
  }
  if (message.type !== "request") return;
  try {
    const data = await runTool(message.tool, message.args || {});
    figma.ui.postMessage({ type: "result", id: message.id, ok: true, data });
  } catch (error) {
    figma.ui.postMessage({ type: "result", id: message.id, ok: false, error: (error && error.message) || String(error) });
  }
};

// Tell Design Agent when you're working in Figma, so "this" means your Figma design.
function reportActivity() {
  const selection = figma.currentPage.selection.filter((n) => !isPointer(n));
  figma.ui.postMessage({
    type: "event",
    name: "activity",
    detail: { file: figma.root.name, page: figma.currentPage.name, selected: selection.length },
  });
}
figma.on("selectionchange", () => {
  const selection = figma.currentPage.selection;
  // Selecting the pointer by accident: ignore it.
  if (selection.length && selection.every(isPointer)) figma.currentPage.selection = [];
  reportActivity();
});
figma.on("currentpagechange", () => {
  removePointer();
  reportActivity();
});
figma.on("close", removePointer);

// Panning or zooming also counts as working in Figma (checked quietly once a second).
let lastView = "";
setInterval(() => {
  const c = figma.viewport.center;
  const view = `${Math.round(c.x)},${Math.round(c.y)},${figma.viewport.zoom.toFixed(3)}`;
  if (lastView && view !== lastView) reportActivity();
  lastView = view;
}, 1000);
