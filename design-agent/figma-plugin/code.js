// Design Agent Figma plugin (main code). Runs inside Figma with access to the open file.
// - Describes what you're looking at (selection, or the frames in view) for the AI:
//   layers with ids, text, fonts, colours, sizes, auto-layout spacing, components, styles.
// - Draws Design Agent's own orange pointer on the canvas (a temporary, locked layer).
// - Applies changes to your design ONLY when Design Agent sends ones you approved
//   (the approval happens in Design Agent; this file just carries them out), and can undo them.

// The plugin's window stays invisible: it only holds the connection to Design Agent.
// A short Figma message says when it's connected (or when Design Agent isn't running).
figma.showUI(__html__, { visible: false });

const ORANGE = { r: 0.949, g: 0.337, b: 0.114 };
const WHITE = { r: 1, g: 1, b: 1 };
const POINTER_TAG = "pointer";
const MARKS_TAG = "review-marks";
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
/** Design Agent's own temporary layers (the pointer and review marks): never part of your design. */
function isPointer(node) {
  try {
    const tag = node.getPluginData("designAgent");
    return tag === POINTER_TAG || tag === MARKS_TAG;
  } catch (e) {
    return false;
  }
}
function hasTag(node, tag) {
  try {
    return node.getPluginData("designAgent") === tag;
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

// Where each layer's listed x/y were measured from (its root frame), from the last description.
const lastOrigins = new Map();

// ---------- describing the design ----------
async function describeNode(node, origin, lines, state, depth, prevBottom) {
  if (state.count >= MAX_NODES || node.visible === false || isPointer(node)) return null;
  const box = node.absoluteBoundingBox;
  if (!box) return null;
  state.count++;
  lastOrigins.set(node.id, origin);

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
  for (const n of figma.currentPage.children) if (hasTag(n, POINTER_TAG)) n.remove();
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

// ---------- review marks: numbered, coloured boxes with a label (UX / UI / Content) ----------
const MARK_KINDS = {
  ux: { color: { r: 0.486, g: 0.302, b: 1 }, label: "UX" },
  ui: { color: { r: 0.118, g: 0.533, b: 0.898 }, label: "UI" },
  content: { color: { r: 0.18, g: 0.62, b: 0.357 }, label: "CONTENT" },
};

function clearMarks() {
  for (const n of figma.currentPage.children) if (hasTag(n, MARKS_TAG)) n.remove();
  return { ok: true };
}

/** marks: [{ id: "12:34", kind: "ux" | "ui" | "content", note }] Drawn as one locked group you can delete. */
async function mark(marks) {
  clearMarks();
  const font = await ensureLabelFont();
  const k = 1 / figma.viewport.zoom; // same size on screen at any zoom
  const nodes = [];
  const missing = [];
  let area = null;
  let number = 0;
  for (const m of marks || []) {
    number++;
    const node = await figma.getNodeByIdAsync(String(m.id || "").split("-")[0]);
    if (!node || !node.absoluteBoundingBox) {
      missing.push(m.id);
      continue;
    }
    const A = node.absoluteBoundingBox;
    const kind = MARK_KINDS[String(m.kind || "").toLowerCase()] || MARK_KINDS.ux;
    const pad = 4 * k;
    const box = figma.createRectangle();
    box.name = `${number}. ${kind.label}`;
    box.x = A.x - pad;
    box.y = A.y - pad;
    box.resize(Math.max(A.width + pad * 2, 1), Math.max(A.height + pad * 2, 1));
    box.fills = [{ type: "SOLID", color: kind.color, opacity: 0.06 }];
    box.strokes = [{ type: "SOLID", color: kind.color }];
    box.strokeWeight = 2 * k;
    box.cornerRadius = 6 * k;
    nodes.push(box);
    if (font) {
      const tag = figma.createFrame();
      tag.name = "label";
      tag.layoutMode = "HORIZONTAL";
      tag.primaryAxisSizingMode = "AUTO";
      tag.counterAxisSizingMode = "AUTO";
      tag.paddingLeft = tag.paddingRight = 8 * k;
      tag.paddingTop = tag.paddingBottom = 4 * k;
      tag.cornerRadius = 8 * k;
      tag.fills = [{ type: "SOLID", color: kind.color }];
      const text = figma.createText();
      text.fontName = font;
      text.fontSize = 12 * k;
      text.characters = `${number}  ${kind.label} · ${String(m.note || "").slice(0, 80)}`;
      text.fills = [{ type: "SOLID", color: WHITE }];
      tag.appendChild(text);
      tag.x = A.x - pad;
      tag.y = A.y - pad - tag.height - 4 * k;
      nodes.push(tag);
    }
    area = area
      ? { x: Math.min(area.x, A.x), y: Math.min(area.y, A.y), r: Math.max(area.r, A.x + A.width), b: Math.max(area.b, A.y + A.height) }
      : { x: A.x, y: A.y, r: A.x + A.width, b: A.y + A.height };
  }
  if (!nodes.length) return { ok: false, marked: 0, missing };
  const group = figma.group(nodes, figma.currentPage);
  group.name = "Design Agent review notes (delete any time)";
  group.setPluginData("designAgent", MARKS_TAG);
  group.locked = true;
  const rect = { x: area.x, y: area.y, width: area.r - area.x, height: area.b - area.y };
  if (!intersects(rect, figma.viewport.bounds)) figma.viewport.center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return { ok: true, marked: number - missing.length, missing };
}

// ---------- changing the design (only approved changes arrive here) ----------
function parseHex(value) {
  const m = String(value || "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}
function inAutoLayout(node) {
  return node.parent && "layoutMode" in node.parent && node.parent.layoutMode && node.parent.layoutMode !== "NONE" && node.layoutPositioning !== "ABSOLUTE";
}
async function loadFontsOf(node) {
  if (node.type !== "TEXT") return;
  const fonts = node.characters.length ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName];
  for (const font of fonts) {
    if (font === figma.mixed) continue;
    try {
      await figma.loadFontAsync(font);
    } catch (e) {
      throw new Error(`the font "${font.family} ${font.style}" isn't available on this computer`);
    }
  }
}
function pad4(node) {
  return [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map(round).join(" ");
}
function nameOf(node) {
  return `"${node.name}"`;
}

/**
 * Checks each change and describes it as "before → after" for the approval card.
 * Changes nothing. Returns { lines, problems, valid } (valid: one true/false per change).
 */
async function preview(changes) {
  const lines = [];
  const problems = [];
  const valid = [];
  for (const c of changes) {
    try {
      lines.push(await describeChange(c));
      valid.push(true);
    } catch (error) {
      problems.push(`${c.action} ${c.id || (c.ids || []).join(",")}: ${error.message}`);
      valid.push(false);
    }
  }
  return { lines, problems, valid };
}

async function need(id) {
  const node = id ? await figma.getNodeByIdAsync(String(id)) : null;
  if (!node || node.removed || node.type === "PAGE" || node.type === "DOCUMENT") throw new Error(`layer ${id} not found`);
  if (isPointer(node)) throw new Error("that's the pointer, not a design layer");
  return node;
}

/** Where a new or moved layer should go: next to "near" (a layer id), else next to what's selected/in view. */
async function anchorFor(c) {
  if (c.near_id) return topFrame(await need(c.near_id));
  const selection = figma.currentPage.selection.filter((n) => !isPointer(n));
  if (selection.length) return topFrame(selection[0]);
  const { roots } = currentRoots();
  return roots.length ? topFrame(roots[0]) : null;
}
const SIDES = ["right", "left", "below", "above"];

async function describeChange(c) {
  if (c.action === "create_design") {
    const problem = checkDesign(c);
    if (problem) throw new Error(problem);
    const anchor = await anchorFor(c);
    const where = anchor ? `to the right of "${anchor.name}"` : "in the middle of your view";
    return `Create ${c.style === "styled" ? "a styled design" : "a wireframe"} "${c.name}" (${round(c.width || 1440)} wide, ${c.nodes.length} layers) ${where}`;
  }
  if (c.action === "place_screenshot") {
    if (!c.capture) throw new Error("that screenshot wasn't found");
    const anchor = await anchorFor(c);
    const side = SIDES.includes(c.side) ? c.side : "right";
    const where = anchor ? `${side === "right" ? "to the right of" : side === "left" ? "to the left of" : side === "below" ? "below" : "above"} "${anchor.name}"` : "in the middle of your view";
    return `Add "${c.capture.name}" (${round(c.capture.css_width)}×${round(c.capture.css_height)}) ${where}`;
  }
  const node = c.action === "group" ? null : await need(c.id);
  switch (c.action) {
    case "set_text":
      if (node.type !== "TEXT") throw new Error("not a text layer");
      return `${nameOf(node)} text: "${node.characters.slice(0, 40)}" → "${String(c.text).slice(0, 40)}"`;
    case "set_font_size":
      if (node.type !== "TEXT") throw new Error("not a text layer");
      if (!(c.font_size > 0)) throw new Error("font size must be a positive number");
      return `${nameOf(node)} font size: ${node.fontSize === figma.mixed ? "mixed" : round(node.fontSize)} → ${round(c.font_size)}`;
    case "set_font": {
      if (node.type !== "TEXT") throw new Error("not a text layer");
      const font = { family: c.font_family || (node.fontName !== figma.mixed ? node.fontName.family : "Inter"), style: c.font_style || "Regular" };
      try {
        await figma.loadFontAsync(font);
      } catch (e) {
        throw new Error(`the font "${font.family} ${font.style}" isn't available`);
      }
      const before = node.fontName === figma.mixed ? "mixed" : `${node.fontName.family} ${node.fontName.style}`;
      return `${nameOf(node)} font: ${before} → ${font.family} ${font.style}`;
    }
    case "set_line_height":
      if (node.type !== "TEXT") throw new Error("not a text layer");
      return `${nameOf(node)} line height: ${node.lineHeight === figma.mixed ? "mixed" : node.lineHeight.unit === "AUTO" ? "auto" : round(node.lineHeight.value)} → ${round(c.line_height)}`;
    case "set_fill": {
      if (!("fills" in node)) throw new Error("this layer has no fill");
      if (!parseHex(c.color)) throw new Error(`"${c.color}" isn't a colour like #1A1A1A`);
      const styleNote = node.fillStyleId && node.fillStyleId !== figma.mixed ? " (detaches its colour style)" : "";
      return `${nameOf(node)} colour: ${describePaints(node.fills) || "none"} → ${c.color.toUpperCase()}${styleNote}`;
    }
    case "set_spacing": {
      if (!("layoutMode" in node) || node.layoutMode === "NONE") throw new Error("not an auto-layout frame (no gap to change)");
      const bits = [];
      if (c.gap !== undefined) bits.push(`gap ${round(node.itemSpacing)} → ${round(c.gap)}`);
      const next = [c.padding_top, c.padding_right, c.padding_bottom, c.padding_left];
      if (c.padding !== undefined || next.some((v) => v !== undefined)) {
        const after = [0, 1, 2, 3].map((i) => (next[i] !== undefined ? next[i] : c.padding !== undefined ? c.padding : [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft][i]));
        bits.push(`padding ${pad4(node)} → ${after.map(round).join(" ")}`);
      }
      if (!bits.length) throw new Error("no gap or padding given");
      return `${nameOf(node)} ${bits.join(", ")}`;
    }
    case "move_by":
    case "move_to": {
      if (inAutoLayout(node)) throw new Error("it's inside an auto-layout frame, so its position comes from the layout (change spacing or order instead)");
      if (c.action === "move_by") return `${nameOf(node)} move by ${round(c.dx || 0)}, ${round(c.dy || 0)}`;
      return `${nameOf(node)} move to x${round(c.x)} y${round(c.y)}`;
    }
    case "resize": {
      if (!("resize" in node)) throw new Error("this layer can't be resized");
      const w = c.width !== undefined ? c.width : node.width;
      const h = c.height !== undefined ? c.height : node.height;
      const hug = inAutoLayout(node) || ("layoutMode" in node && node.layoutMode !== "NONE") ? " (sets its size to fixed)" : "";
      return `${nameOf(node)} size: ${round(node.width)}×${round(node.height)} → ${round(w)}×${round(h)}${hug}`;
    }
    case "set_radius":
      if (!("cornerRadius" in node)) throw new Error("this layer has no corner radius");
      return `${nameOf(node)} corner radius: ${node.cornerRadius === figma.mixed ? "mixed" : round(node.cornerRadius)} → ${round(c.radius)}`;
    case "rename":
      return `Rename ${nameOf(node)} → "${c.name}"`;
    case "place_next_to": {
      if (inAutoLayout(node)) throw new Error("it's inside an auto-layout frame, so its position comes from the layout");
      const target = await need(c.target_id);
      const side = SIDES.includes(c.side) ? c.side : "right";
      return `Move ${nameOf(node)} ${side === "right" ? "to the right of" : side === "left" ? "to the left of" : side} ${nameOf(target)}`;
    }
    case "duplicate":
      return `Duplicate ${nameOf(node)}`;
    case "create_component":
      if (!["FRAME", "GROUP", "RECTANGLE", "TEXT", "ELLIPSE", "VECTOR"].includes(node.type)) throw new Error("only frames, groups and shapes can become components");
      return `Turn ${nameOf(node)} into a component`;
    case "group": {
      const nodes = [];
      for (const id of c.ids || []) nodes.push(await need(id));
      if (nodes.length < 2) throw new Error("need at least two layers to group");
      if (nodes.some((n) => n.parent !== nodes[0].parent)) throw new Error("layers must be in the same parent to group");
      return `Group ${nodes.map(nameOf).join(", ")}${c.name ? ` as "${c.name}"` : ""}`;
    }
    default:
      throw new Error(`unknown change "${c.action}"`);
  }
}

// What each applied batch changed, so it can be undone.
const undoLog = new Map();
let undoCounter = 0;

function snapshotProps(node) {
  const before = { id: node.id, name: node.name, x: node.x, y: node.y, width: node.width, height: node.height };
  if ("fills" in node && node.fills !== figma.mixed) before.fills = node.fills;
  if ("fillStyleId" in node && node.fillStyleId !== figma.mixed) before.fillStyleId = node.fillStyleId;
  if ("cornerRadius" in node && node.cornerRadius !== figma.mixed) before.cornerRadius = node.cornerRadius;
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    before.spacing = { itemSpacing: node.itemSpacing, paddingTop: node.paddingTop, paddingRight: node.paddingRight, paddingBottom: node.paddingBottom, paddingLeft: node.paddingLeft };
  }
  if ("layoutSizingHorizontal" in node) before.sizing = [node.layoutSizingHorizontal, node.layoutSizingVertical];
  if (node.type === "TEXT") {
    before.characters = node.characters;
    if (node.fontSize !== figma.mixed) before.fontSize = node.fontSize;
    if (node.fontName !== figma.mixed) before.fontName = node.fontName;
    if (node.lineHeight !== figma.mixed) before.lineHeight = node.lineHeight;
  }
  return before;
}

async function applyOne(c, record) {
  if (c.action === "group") {
    const nodes = [];
    for (const id of c.ids || []) nodes.push(await need(id));
    const group = figma.group(nodes, nodes[0].parent);
    if (c.name) group.name = c.name;
    record.push({ kind: "ungroup", id: group.id });
    return group;
  }
  if (c.action === "create_design") {
    const root = await buildDesign(c);
    record.push({ kind: "remove", id: root.id });
    return root;
  }
  if (c.action === "place_screenshot") {
    const frame = await placeScreenshot(c);
    record.push({ kind: "remove", id: frame.id });
    return frame;
  }
  const node = await need(c.id);
  if (c.action === "duplicate") {
    const copy = node.clone();
    const parent = node.parent;
    parent.insertChild(parent.children.indexOf(node) + 1, copy);
    if (!inAutoLayout(copy)) copy.x = node.x + node.width + 40;
    record.push({ kind: "remove", id: copy.id });
    return copy;
  }
  if (c.action === "create_component") {
    const component = figma.createComponentFromNode(node);
    record.push({ kind: "none", note: "turned into a component (use Ctrl+Z in Figma to undo)" });
    return component;
  }

  record.push({ kind: "restore", action: c.action, before: snapshotProps(node) });
  switch (c.action) {
    case "set_text":
      await loadFontsOf(node);
      node.characters = String(c.text);
      break;
    case "set_font_size":
      await loadFontsOf(node);
      node.fontSize = Number(c.font_size);
      break;
    case "set_font": {
      const font = { family: c.font_family || node.fontName.family, style: c.font_style || "Regular" };
      await figma.loadFontAsync(font);
      await loadFontsOf(node);
      node.fontName = font;
      break;
    }
    case "set_line_height":
      await loadFontsOf(node);
      node.lineHeight = { value: Number(c.line_height), unit: "PIXELS" };
      break;
    case "set_fill": {
      const color = parseHex(c.color);
      const old = firstSolid(node.fills);
      node.fills = [{ type: "SOLID", color, opacity: old && old.opacity !== undefined ? old.opacity : 1 }];
      break;
    }
    case "set_spacing":
      if (c.gap !== undefined) node.itemSpacing = Number(c.gap);
      if (c.padding !== undefined) node.paddingTop = node.paddingRight = node.paddingBottom = node.paddingLeft = Number(c.padding);
      if (c.padding_top !== undefined) node.paddingTop = Number(c.padding_top);
      if (c.padding_right !== undefined) node.paddingRight = Number(c.padding_right);
      if (c.padding_bottom !== undefined) node.paddingBottom = Number(c.padding_bottom);
      if (c.padding_left !== undefined) node.paddingLeft = Number(c.padding_left);
      break;
    case "move_by":
      node.x += Number(c.dx || 0);
      node.y += Number(c.dy || 0);
      break;
    case "move_to": {
      // x/y are relative to the root frame used in the description.
      const origin = lastOrigins.get(node.id) || { x: 0, y: 0 };
      const abs = node.absoluteBoundingBox;
      node.x += origin.x + Number(c.x) - abs.x;
      node.y += origin.y + Number(c.y) - abs.y;
      break;
    }
    case "resize":
      if ("layoutSizingHorizontal" in node && (inAutoLayout(node) || ("layoutMode" in node && node.layoutMode !== "NONE"))) {
        if (c.width !== undefined) node.layoutSizingHorizontal = "FIXED";
        if (c.height !== undefined) node.layoutSizingVertical = "FIXED";
      }
      if (node.type === "TEXT") await loadFontsOf(node);
      node.resize(c.width !== undefined ? Number(c.width) : node.width, c.height !== undefined ? Number(c.height) : node.height);
      break;
    case "set_radius":
      node.cornerRadius = Number(c.radius);
      break;
    case "rename":
      node.name = String(c.name);
      break;
    case "place_next_to": {
      const target = await need(c.target_id);
      const spot = spotNextTo(topFrameBox(target, c.target_id), node.absoluteBoundingBox, c.side, c.gap);
      const abs = node.absoluteBoundingBox;
      node.x += spot.x - abs.x;
      node.y += spot.y - abs.y;
      break;
    }
    default:
      throw new Error(`unknown change "${c.action}"`);
  }
  return node;
}

async function apply(changes) {
  removePointer();
  const record = [];
  const results = [];
  const touched = [];
  for (const c of changes) {
    try {
      const node = await applyOne(c, record);
      if (node) touched.push(node);
      const created = ["place_screenshot", "duplicate", "group", "create_design"].includes(c.action) && node ? node.id : undefined;
      results.push({ ok: true, change: c.action, id: c.id || (c.ids || []).join(",") || c.capture_id, created, capture_id: c.capture_id, page: figma.currentPage.name });
    } catch (error) {
      results.push({ ok: false, change: c.action, id: c.id || (c.ids || []).join(","), error: error.message });
    }
  }
  figma.commitUndo(); // so Ctrl+Z in Figma undoes exactly this batch
  const token = `u${++undoCounter}`;
  undoLog.set(token, record);

  // Describe the result so Design Agent can check it (VERIFY).
  const lines = [];
  const state = { count: 0 };
  for (const node of touched.slice(0, 6)) {
    if (node.removed) continue;
    await describeNode(node, lastOrigins.get(node.id) || node.absoluteBoundingBox || { x: 0, y: 0 }, lines, state, 0, null);
  }
  let screenshot = null;
  const root = touched.length ? topFrame(touched[0]) : null;
  if (root && root.absoluteBoundingBox) {
    try {
      const b = root.absoluteBoundingBox;
      const scale = Math.max(0.05, Math.min(2, 1400 / Math.max(b.width, b.height)));
      screenshot = figma.base64Encode(await root.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: scale } }));
    } catch (e) {
      screenshot = null;
    }
  }
  if (touched[0] && !touched[0].removed) figma.currentPage.selection = [touched[0]];
  return { results, token, after: lines.join("\n"), screenshot, file: figma.root.name, fileKey: fileKey() };
}

/** Top-left corner for something of size "box" placed beside "anchor" (both absolute). */
function spotNextTo(anchor, box, side, gap) {
  const space = gap !== undefined ? Number(gap) : 100;
  if (side === "left") return { x: anchor.x - box.width - space, y: anchor.y };
  if (side === "below") return { x: anchor.x, y: anchor.y + anchor.height + space };
  if (side === "above") return { x: anchor.x, y: anchor.y - box.height - space };
  return { x: anchor.x + anchor.width + space, y: anchor.y };
}
function topFrameBox(node) {
  return node.absoluteBoundingBox;
}

// ---------- creating new designs and wireframes ----------
const DESIGN_TYPES = ["frame", "text", "rect", "image", "button", "input", "icon", "divider"];
const MAX_DESIGN_NODES = 150;

/** Checks a design plan (a flat list of nodes, each pointing at its parent by key). */
function checkDesign(c) {
  const nodes = Array.isArray(c.nodes) ? c.nodes : [];
  if (!nodes.length) return "the design has no layers";
  if (nodes.length > MAX_DESIGN_NODES) return `too many layers (${nodes.length}; the limit is ${MAX_DESIGN_NODES})`;
  const keys = new Set();
  for (const n of nodes) {
    if (!n.key) return "every layer needs a key";
    if (keys.has(n.key)) return `the key "${n.key}" is used twice`;
    keys.add(n.key);
    if (!DESIGN_TYPES.includes(n.type)) return `unknown layer type "${n.type}"`;
  }
  for (const n of nodes) if (n.parent && !keys.has(n.parent)) return `"${n.key}" points to a missing parent "${n.parent}"`;
  return "";
}

/** Wireframes are greyscale: any colour becomes a grey of similar lightness. */
function greyOf(hex, fallback) {
  const c = parseHex(hex);
  if (!c) return fallback;
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return { r: l, g: l, b: l };
}

const WEIGHTS = { regular: "Regular", medium: "Medium", semibold: "Semi Bold", bold: "Bold" };
async function fontFor(family, weight) {
  const style = WEIGHTS[weight] || "Regular";
  for (const font of [{ family, style }, { family, style: "Regular" }, { family: "Inter", style }, { family: "Inter", style: "Regular" }]) {
    try {
      await figma.loadFontAsync(font);
      return font;
    } catch (e) {
      // try the next one
    }
  }
  throw new Error("no usable font (Inter isn't available)");
}

/** The main font of this file (from its text styles), for styled designs. */
async function fileFontFamily() {
  try {
    const styles = await figma.getLocalTextStylesAsync();
    if (styles.length) return styles[0].fontName.family;
  } catch (e) {
    // ignore
  }
  return "Inter";
}

const ALIGN = { start: "MIN", center: "CENTER", end: "MAX", space_between: "SPACE_BETWEEN" };
const CROSS = { start: "MIN", center: "CENTER", end: "MAX" };

async function buildDesign(c) {
  const problem = checkDesign(c);
  if (problem) throw new Error(problem);
  const wire = c.style !== "styled";
  const family = wire ? "Inter" : c.font_family || (await fileFontFamily());
  const anchor = await anchorFor(c); // decide where it goes before adding anything
  const color = (hex, wireDefault, styledDefault) =>
    wire ? greyOf(hex, wireDefault) : parseHex(hex) || styledDefault;

  const byKey = new Map();
  const spec = new Map(c.nodes.map((n) => [n.key, n]));
  const children = new Map();
  let rootSpec = null;
  for (const n of c.nodes) {
    if (!n.parent) {
      if (!rootSpec) rootSpec = n;
      else n.parent = rootSpec.key; // only one top frame; others go inside it
    }
    if (n.parent) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent).push(n);
    }
  }
  if (!rootSpec) rootSpec = c.nodes[0];

  function autoLayout(frame, n, defaultDirection) {
    frame.layoutMode = n.direction === "horizontal" ? "HORIZONTAL" : n.direction === "vertical" ? "VERTICAL" : defaultDirection;
    frame.itemSpacing = n.gap !== undefined ? Number(n.gap) : 0;
    const px = n.padding_x !== undefined ? n.padding_x : n.padding !== undefined ? n.padding : 0;
    const py = n.padding_y !== undefined ? n.padding_y : n.padding !== undefined ? n.padding : 0;
    frame.paddingLeft = frame.paddingRight = Number(px);
    frame.paddingTop = frame.paddingBottom = Number(py);
    frame.primaryAxisAlignItems = ALIGN[n.align] || "MIN";
    frame.counterAxisAlignItems = CROSS[n.cross_align] || "MIN";
    frame.fills = [];
  }

  async function text(n, fallbackColor, size) {
    const t = figma.createText();
    t.fontName = await fontFor(family, n.font_weight);
    t.characters = String(n.text || n.name || "Text");
    t.fontSize = Number(n.font_size) || size;
    t.fills = [{ type: "SOLID", color: color(n.text_color, fallbackColor, fallbackColor) }];
    if (n.text_align) t.textAlignHorizontal = n.text_align === "center" ? "CENTER" : n.text_align === "right" ? "RIGHT" : "LEFT";
    return t;
  }

  async function create(n) {
    let node;
    switch (n.type) {
      case "frame":
        node = figma.createFrame();
        autoLayout(node, n, "VERTICAL");
        if (n.fill) node.fills = [{ type: "SOLID", color: color(n.fill, { r: 0.96, g: 0.96, b: 0.96 }, WHITE) }];
        break;
      case "text":
        node = await text(n, n.font_size >= 24 ? { r: 0.1, g: 0.1, b: 0.1 } : { r: 0.25, g: 0.25, b: 0.25 }, 16);
        break;
      case "button": {
        node = figma.createFrame();
        autoLayout(node, { ...n, direction: "horizontal", align: "center", cross_align: "center" }, "HORIZONTAL");
        node.paddingLeft = node.paddingRight = n.padding_x !== undefined ? Number(n.padding_x) : 20;
        node.paddingTop = node.paddingBottom = n.padding_y !== undefined ? Number(n.padding_y) : 12;
        node.cornerRadius = n.radius !== undefined ? Number(n.radius) : 8;
        const bg = color(n.fill, { r: 0.24, g: 0.24, b: 0.24 }, { r: 0.1, g: 0.1, b: 0.1 });
        node.fills = [{ type: "SOLID", color: bg }];
        const light = luminance(bg) < 0.4;
        const label = await text({ ...n, text: n.text || "Button", font_weight: n.font_weight || "semibold", text_color: n.text_color || (light ? "#FFFFFF" : "#111111") }, light ? WHITE : { r: 0.07, g: 0.07, b: 0.07 }, 16);
        label.name = "Label";
        node.appendChild(label);
        break;
      }
      case "input": {
        node = figma.createFrame();
        autoLayout(node, { ...n, direction: "horizontal", cross_align: "center" }, "HORIZONTAL");
        node.paddingLeft = node.paddingRight = 14;
        node.paddingTop = node.paddingBottom = 12;
        node.cornerRadius = n.radius !== undefined ? Number(n.radius) : 8;
        node.fills = [{ type: "SOLID", color: WHITE }];
        node.strokes = [{ type: "SOLID", color: color(n.stroke, { r: 0.75, g: 0.75, b: 0.75 }, { r: 0.8, g: 0.8, b: 0.8 }) }];
        node.strokeWeight = 1;
        const placeholder = await text({ ...n, text: n.text || "Placeholder", text_color: n.text_color || "#8A8A8A" }, { r: 0.54, g: 0.54, b: 0.54 }, 16);
        placeholder.name = "Placeholder";
        node.appendChild(placeholder);
        if (n.fill_width === undefined) n.fill_width = true;
        break;
      }
      case "image": {
        node = figma.createFrame();
        autoLayout(node, { direction: "vertical", align: "center", cross_align: "center" }, "VERTICAL");
        node.fills = [{ type: "SOLID", color: wire ? { r: 0.85, g: 0.85, b: 0.85 } : parseHex(n.fill) || { r: 0.9, g: 0.9, b: 0.92 } }];
        node.cornerRadius = n.radius !== undefined ? Number(n.radius) : 8;
        const label = await text({ text: n.text || "Image", font_size: 14, text_color: "#7A7A7A" }, { r: 0.48, g: 0.48, b: 0.48 }, 14);
        label.name = "Label";
        node.appendChild(label);
        break;
      }
      case "icon":
        node = figma.createEllipse();
        node.resize(Number(n.width) || 24, Number(n.height) || Number(n.width) || 24);
        node.fills = [{ type: "SOLID", color: color(n.fill, { r: 0.7, g: 0.7, b: 0.7 }, { r: 0.6, g: 0.6, b: 0.65 }) }];
        break;
      case "divider":
        node = figma.createRectangle();
        node.resize(Number(n.width) || 100, 1);
        node.fills = [{ type: "SOLID", color: color(n.fill, { r: 0.88, g: 0.88, b: 0.88 }, { r: 0.9, g: 0.9, b: 0.9 }) }];
        if (n.fill_width === undefined) n.fill_width = true;
        break;
      default: // rect
        node = figma.createRectangle();
        node.resize(Number(n.width) || 100, Number(n.height) || 100);
        node.fills = [{ type: "SOLID", color: color(n.fill, { r: 0.85, g: 0.85, b: 0.85 }, { r: 0.9, g: 0.9, b: 0.9 }) }];
    }
    // Readable layer names: the given name, else the text (for text, buttons, inputs), else the key.
    node.name = n.name || (["text", "button", "input", "image"].includes(n.type) && n.text) || n.key || n.type;
    if (n.radius !== undefined && "cornerRadius" in node && n.type !== "button" && n.type !== "input") node.cornerRadius = Number(n.radius);
    if (n.stroke && n.type !== "input" && "strokes" in node) {
      node.strokes = [{ type: "SOLID", color: color(n.stroke, { r: 0.75, g: 0.75, b: 0.75 }, { r: 0.8, g: 0.8, b: 0.8 }) }];
      node.strokeWeight = 1;
    }
    return node;
  }

  /** Sizes a node once it's inside its parent (fill / hug / fixed). */
  function size(node, n, parentNode) {
    const inAuto = parentNode && "layoutMode" in parentNode && parentNode.layoutMode !== "NONE";
    const parentVertical = inAuto && parentNode.layoutMode === "VERTICAL";
    const isText = node.type === "TEXT";
    const canHug = isText || ("layoutMode" in node && node.layoutMode !== "NONE");
    // Width
    if (n.width !== undefined && !n.fill_width) {
      if (canHug || inAuto) node.layoutSizingHorizontal = "FIXED";
      node.resize(Number(n.width), node.height);
    } else if (inAuto && (n.fill_width || (parentVertical && ["frame", "input", "divider", "image"].includes(n.type)) || (parentVertical && isText))) {
      node.layoutSizingHorizontal = "FILL";
    } else if (canHug) {
      node.layoutSizingHorizontal = "HUG";
    }
    // Height
    if (n.height !== undefined && !n.fill_height) {
      if (canHug || inAuto) node.layoutSizingVertical = "FIXED";
      node.resize(node.width, Number(n.height));
    } else if (inAuto && n.fill_height) {
      node.layoutSizingVertical = "FILL";
    } else if (canHug) {
      node.layoutSizingVertical = "HUG";
    }
    if (n.type === "image" && n.height === undefined) {
      node.layoutSizingVertical = "FIXED";
      node.resize(node.width, 200);
    }
  }

  // Build top-down: the top frame first, then each layer inside its parent.
  const root = await create({ ...rootSpec, type: "frame" });
  root.name = c.name || rootSpec.name || "New design";
  if (!rootSpec.fill) root.fills = [{ type: "SOLID", color: WHITE }];
  root.layoutSizingHorizontal = "FIXED";
  root.resize(Number(c.width || rootSpec.width) || 1440, 100);
  root.layoutSizingVertical = "HUG";
  byKey.set(rootSpec.key, root);

  const queue = [rootSpec.key];
  while (queue.length) {
    const parentKey = queue.shift();
    const parentNode = byKey.get(parentKey);
    for (const n of children.get(parentKey) || []) {
      const node = await create(n);
      if ("appendChild" in parentNode) parentNode.appendChild(node);
      try {
        size(node, n, parentNode);
      } catch (e) {
        // sizing is best-effort; the layer still exists
      }
      byKey.set(n.key, node);
      if (spec.get(n.key) && children.has(n.key) && "appendChild" in node) queue.push(n.key);
    }
  }
  const minHeight = Number(c.min_height || rootSpec.height) || 0;
  if (minHeight && root.height < minHeight) {
    root.layoutSizingVertical = "FIXED";
    root.resize(root.width, minHeight);
  }

  const box = { x: 0, y: 0, width: root.width, height: root.height };
  const spot = anchor
    ? spotNextTo(anchor.absoluteBoundingBox, box, "right", 100)
    : { x: figma.viewport.center.x - root.width / 2, y: figma.viewport.center.y - Math.min(root.height, 800) / 2 };
  root.x = spot.x;
  root.y = spot.y;
  figma.viewport.scrollAndZoomIntoView([root]);
  return root;
}

/** Adds a screenshot as a frame of stacked image slices (Figma images max out at 4096 px). */
async function placeScreenshot(c) {
  const slices = c.images || [];
  if (!slices.length) throw new Error("the screenshot's image data is missing");
  const width = Number(c.capture.css_width);
  const scale = width / slices[0].width;
  const anchor = await anchorFor(c); // decide where it goes before adding anything
  const frame = figma.createFrame();
  frame.name = c.capture.name;
  frame.fills = [];
  frame.clipsContent = true;
  let y = 0;
  for (const slice of slices) {
    const image = figma.createImage(figma.base64Decode(slice.base64));
    const rect = figma.createRectangle();
    rect.name = slices.length > 1 ? `Part ${frame.children.length + 1}` : "Screenshot";
    rect.resize(width, slice.height * scale);
    rect.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
    frame.appendChild(rect);
    rect.x = 0;
    rect.y = y;
    y += slice.height * scale;
  }
  frame.resize(width, y);
  frame.setPluginData("designAgentCapture", String(c.capture_id || ""));

  const box = { x: 0, y: 0, width, height: y };
  const spot = anchor
    ? spotNextTo(anchor.absoluteBoundingBox, box, SIDES.includes(c.side) ? c.side : "right", c.gap)
    : { x: figma.viewport.center.x - width / 2, y: figma.viewport.center.y - Math.min(y, 800) / 2 };
  frame.x = spot.x;
  frame.y = spot.y;
  figma.viewport.scrollAndZoomIntoView([frame]);
  return frame;
}

function topFrame(node) {
  let n = node;
  while (n.parent && n.parent.type !== "PAGE") n = n.parent;
  return n;
}

async function undo(token) {
  const record = undoLog.get(token);
  if (!record) return { ok: false, reason: "nothing to undo" };
  const notes = [];
  for (const step of record.slice().reverse()) {
    try {
      if (step.kind === "remove") {
        const n = await figma.getNodeByIdAsync(step.id);
        if (n && !n.removed) n.remove();
      } else if (step.kind === "ungroup") {
        const n = await figma.getNodeByIdAsync(step.id);
        if (n && !n.removed) figma.ungroup(n);
      } else if (step.kind === "restore") {
        const b = step.before;
        const n = await figma.getNodeByIdAsync(b.id);
        if (!n || n.removed) continue;
        if (n.type === "TEXT") await loadFontsOf(n);
        if (b.fontName) {
          await figma.loadFontAsync(b.fontName);
          n.fontName = b.fontName;
        }
        if (b.characters !== undefined && n.characters !== b.characters) n.characters = b.characters;
        if (b.fontSize !== undefined) n.fontSize = b.fontSize;
        if (b.lineHeight !== undefined) n.lineHeight = b.lineHeight;
        if (b.fillStyleId) await n.setFillStyleIdAsync(b.fillStyleId);
        else if (b.fills !== undefined) n.fills = b.fills;
        if (b.spacing) Object.assign(n, b.spacing);
        if (b.cornerRadius !== undefined) n.cornerRadius = b.cornerRadius;
        if (b.sizing) {
          try {
            n.layoutSizingHorizontal = b.sizing[0];
            n.layoutSizingVertical = b.sizing[1];
          } catch (e) {
            // not in auto-layout; size is restored below
          }
        }
        if (n.name !== b.name) n.name = b.name;
        const fixed = !b.sizing || (b.sizing[0] === "FIXED" && b.sizing[1] === "FIXED");
        if (step.action === "resize" && "resize" in n && fixed && (Math.abs(n.width - b.width) > 0.01 || Math.abs(n.height - b.height) > 0.01)) n.resize(b.width, b.height);
        if (/^move_|^resize$/.test(step.action) && !inAutoLayout(n)) {
          n.x = b.x;
          n.y = b.y;
        }
      } else if (step.note) {
        notes.push(step.note);
      }
    } catch (error) {
      notes.push(error.message);
    }
  }
  figma.commitUndo();
  undoLog.delete(token);
  return { ok: true, notes };
}

// ---------- finding things and going to them (doesn't change the design) ----------
function pageOf(node) {
  let n = node;
  while (n && n.type !== "PAGE") n = n.parent;
  return n;
}
function hasImageFill(node) {
  return "fills" in node && Array.isArray(node.fills) && node.fills.some((f) => f.type === "IMAGE" && f.visible !== false);
}

/** Searches every page for layers by name, screenshots Design Agent placed, and images. */
async function find(query) {
  await figma.loadAllPagesAsync();
  const q = String(query).toLowerCase().trim();
  const wantsImages = !q || /screen ?shot|image|picture|photo|upload/.test(q);
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !/^(the|screenshot|screenshots|image|images|picture|photo|uploaded|upload|earlier|my|from)$/.test(w));
  const found = [];
  for (const page of figma.root.children) {
    const nodes = page.findAll((n) => {
      if (isPointer(n)) return false;
      const byAgent = n.getPluginData("designAgentCapture") !== "";
      const name = n.name.toLowerCase();
      const nameMatch = words.length > 0 && words.every((w) => name.includes(w));
      // Images: only fairly big ones near the top of the page tree (not icons inside components).
      const depth = (() => { let d = 0; for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent) d++; return d; })();
      const bigImage = wantsImages && hasImageFill(n) && n.width >= 200 && n.height >= 150 && depth <= 2 && !(n.parent && n.parent.getPluginData && n.parent.getPluginData("designAgentCapture"));
      return (wantsImages && byAgent) || nameMatch || bigImage;
    });
    for (const n of nodes) {
      found.push({
        id: n.id,
        name: n.name,
        page: page.name,
        type: n.type.toLowerCase(),
        size: `${round(n.width)}x${round(n.height)}`,
        placed_by_design_agent: n.getPluginData("designAgentCapture") !== "",
      });
      if (found.length >= 40) break;
    }
    if (found.length >= 40) break;
  }
  return { file: figma.root.name, current_page: figma.currentPage.name, results: found };
}

/** Switches to the layer's page, selects it, zooms to it and points at it. */
async function goTo(id) {
  const node = await figma.getNodeByIdAsync(String(id));
  if (!node || node.removed || node.type === "PAGE" || node.type === "DOCUMENT") return { ok: false, reason: "that layer isn't in this file (it may have been deleted)" };
  const page = pageOf(node);
  if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
  await point(node.id);
  return { ok: true, page: page ? page.name : "", name: node.name };
}

// ---------- talking to Design Agent (through the plugin window) ----------
async function runTool(tool, args) {
  if (tool === "figma.snapshot") return snapshot();
  if (tool === "figma.preview") return preview(args.changes || []);
  if (tool === "figma.apply") return apply(args.changes || []);
  if (tool === "figma.undo") return undo(args.token);
  if (tool === "figma.find") return find(args.query || "");
  if (tool === "figma.goto") return goTo(args.id);
  if (tool === "figma.point") return point(args.target);
  if (tool === "figma.mark") return mark(args.marks || []);
  if (tool === "figma.clear_marks") return clearMarks();
  if (tool === "figma.hide") {
    removePointer();
    return { ok: true };
  }
  throw new Error(`unknown tool ${tool}`);
}

figma.ui.onmessage = async (message) => {
  if (message.type === "connected") {
    figma.notify("Design Agent connected", { timeout: 2500 });
    reportActivity();
    return;
  }
  if (message.type === "not-running") {
    figma.notify("Design Agent isn't running. Start it on your computer and this connects by itself.", { timeout: 6000 });
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
/** The file's key (for a link to it), when Figma shares it with this plugin. */
function fileKey() {
  try {
    return figma.fileKey || "";
  } catch (e) {
    return "";
  }
}

function reportActivity() {
  const selection = figma.currentPage.selection.filter((n) => !isPointer(n));
  figma.ui.postMessage({
    type: "event",
    name: "activity",
    detail: { file: figma.root.name, fileKey: fileKey(), page: figma.currentPage.name, selected: selection.length },
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
