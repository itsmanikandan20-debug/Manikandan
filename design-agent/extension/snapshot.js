// Runs INSIDE the web page (injected by background.js) and describes what's visible:
// every meaningful element with an id (w1, w2, …), its text, position, size, font,
// colours, contrast and the gap above it, plus page-wide facts (fonts, palette, headings).
// Chrome reads this file fresh for every injection, so updates to it apply without
// reloading the add-on. The value of the last line is what gets sent back.
(function collectPage() {
  const MAX_ELEMENTS = 160;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ---------- colour helpers ----------
  function parseColor(value) {
    const m = String(value).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  function hex(c) {
    return "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  }
  function luminance(c) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function backgroundOf(el) {
    // Walk up until something paints a solid-ish background.
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") return { image: true };
      const c = parseColor(style.backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  // ---------- which elements matter ----------
  const TEXT_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "A", "BUTTON", "LABEL", "LI", "SPAN", "STRONG", "EM", "SMALL", "TD", "TH", "FIGCAPTION", "BLOCKQUOTE", "DT", "DD", "DIV"]);
  const ALWAYS = new Set(["IMG", "SVG", "VIDEO", "INPUT", "SELECT", "TEXTAREA", "BUTTON", "CANVAS", "IFRAME"]);
  const CONTAINERS = new Set(["HEADER", "NAV", "MAIN", "SECTION", "FOOTER", "FORM", "ASIDE", "ARTICLE", "DIV"]);

  function ownText(el) {
    let text = "";
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.textContent;
    return text.replace(/\s+/g, " ").trim();
  }
  function visible(el, rect, style) {
    if (rect.width < 2 || rect.height < 2) return false;
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) return false;
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 0.05) return false;
    return true;
  }

  document.querySelectorAll("[data-da-id]").forEach((el) => el.removeAttribute("data-da-id"));

  const lines = [];
  const textColors = new Map();
  const bgColors = new Map();
  let count = 0;
  const lastBottomByParent = new Map();
  if (document.body) {
    const pageBg = backgroundOf(document.body);
    if (!pageBg.image) bgColors.set(hex(pageBg), vw * vh);
  }

  const all = document.body ? document.body.querySelectorAll("*") : [];
  for (const el of all) {
    if (count >= MAX_ELEMENTS) break;
    const tag = el.tagName.toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "PATH" || el.closest("svg") && tag !== "SVG") continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (!visible(el, rect, style)) continue;

    const text = TEXT_TAGS.has(tag) ? ownText(el) : "";
    const bg = parseColor(style.backgroundColor);
    const paintsBox =
      CONTAINERS.has(tag) &&
      ((bg && bg.a > 0.5) || style.backgroundImage !== "none" || parseFloat(style.borderTopWidth) > 0 || style.boxShadow !== "none") &&
      rect.width * rect.height > vw * vh * 0.04;
    const isControl = ALWAYS.has(tag) || el.getAttribute("role") === "button";
    if (!text && !paintsBox && !isControl) continue;
    if (tag === "DIV" && !text && !paintsBox) continue;

    count++;
    const id = "w" + count;
    el.setAttribute("data-da-id", id);

    const parts = [id, tag.toLowerCase()];
    if (el.getAttribute("role")) parts.push(`role=${el.getAttribute("role")}`);
    const label = text || el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || el.getAttribute("title") || (tag === "INPUT" ? el.value : "");
    if (label) parts.push(JSON.stringify(label.length > 90 ? label.slice(0, 87) + "..." : label));
    if (tag === "IMG") parts.push(el.getAttribute("alt") === null ? "NO-ALT" : el.getAttribute("alt") === "" ? "alt=empty(decorative)" : "");
    if (tag === "A" && el.getAttribute("href")) parts.push("link");
    parts.push(`x${Math.round(rect.left)} y${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);

    // Gap to the previous visible sibling-level element above (vertical rhythm).
    const parent = el.parentElement;
    const above = lastBottomByParent.get(parent);
    if (above !== undefined && rect.top >= above) parts.push(`gapAbove ${Math.round(rect.top - above)}`);
    lastBottomByParent.set(parent, rect.bottom);

    if (text || tag === "BUTTON" || tag === "A" || tag === "INPUT") {
      const family = style.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      parts.push(`font "${family}" ${Math.round(parseFloat(style.fontSize))}px w${style.fontWeight}`);
      const lh = parseFloat(style.lineHeight);
      if (lh) parts.push(`lh ${Math.round(lh)}px`);
      if (style.letterSpacing !== "normal") parts.push(`ls ${style.letterSpacing}`);
      if (style.textTransform !== "none") parts.push(style.textTransform);
      const color = parseColor(style.color);
      const back = backgroundOf(el);
      if (color) {
        parts.push(`color ${hex(color)}`);
        textColors.set(hex(color), (textColors.get(hex(color)) || 0) + (text.length || 1));
        if (back.image) parts.push("on image");
        else {
          const ratio = contrast(color, back);
          parts.push(`on ${hex(back)} contrast ${ratio.toFixed(1)}${ratio < 4.5 && parseFloat(style.fontSize) < 24 ? " LOW" : ""}`);
        }
      }
    }
    if (bg && bg.a > 0.5) {
      if (!text) parts.push(`bg ${hex(bg)}`);
      bgColors.set(hex(bg), (bgColors.get(hex(bg)) || 0) + rect.width * rect.height);
    }
    if (parseFloat(style.borderRadius)) parts.push(`radius ${style.borderRadius}`);
    if (tag === "BUTTON" || tag === "A" || isControl || paintsBox) {
      const pad = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((v) => Math.round(parseFloat(v)));
      if (pad.some(Boolean)) parts.push(`padding ${pad.join(" ")}`);
    }
    if (style.display.includes("flex") || style.display.includes("grid")) {
      parts.push(style.display + (style.gap && style.gap !== "normal" ? ` gap ${style.gap}` : ""));
    }
    lines.push(parts.filter(Boolean).join(" | "));
  }

  // ---------- page-wide facts ----------
  const loadedFonts = new Set();
  try {
    document.fonts.forEach((face) => {
      if (face.status === "loaded") loadedFonts.add(`${face.family.replace(/["']/g, "")} ${face.weight}`);
    });
  } catch {
    // some pages block this
  }
  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .slice(0, 25)
    .map((h) => `${h.tagName.toLowerCase()} "${h.textContent.replace(/\s+/g, " ").trim().slice(0, 70)}"`);
  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c).join(", ");
  const images = [...document.images];

  const info = [
    `URL: ${location.href}`,
    `Title: ${document.title}`,
    `Viewport: ${vw}x${vh}, scrolled ${Math.round(scrollY)}px of ${document.documentElement.scrollHeight}px page height`,
    `Language: ${document.documentElement.lang || "not set"}`,
    `Web fonts loaded: ${[...loadedFonts].join(", ") || "none (system fonts only)"}`,
    `Body font stack: ${getComputedStyle(document.body).fontFamily}`,
    `Main text colours: ${top(textColors) || "-"}`,
    `Main background colours: ${top(bgColors) || "-"}`,
    `Headings on the whole page: ${headings.join("; ") || "none"}`,
    `Images: ${images.length}, without alt text: ${images.filter((i) => i.getAttribute("alt") === null).length}`,
  ];

  return {
    url: location.href,
    title: document.title,
    count,
    text:
      info.join("\n") +
      "\n\nVisible elements (id | tag | text | position x,y and size in CSS px | details):\n" +
      lines.join("\n"),
  };
})();
