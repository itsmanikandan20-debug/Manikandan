import type { DesignElement, ElementType } from "./types";

// A hand-built "landing page" spec used to generate both the Demo Mode
// screenshots (as inline SVG) and the matching DesignElement[] data, so the
// picture on screen and the bounding boxes the UI draws over it always
// agree with each other. Two specs are defined (Figma "intended" vs
// "website" actual) in demo-figma.ts / demo-website.ts — every field that
// differs between them is exactly one of the demo's planted issues.

export interface PageSpec {
  source: "figma" | "website";
  canvasWidth: number;
  canvasHeight: number;
  fontFamily: string;
  footerFontFamily: string;
  nav: {
    logo: string;
    links: string[];
    buttonText: string;
    buttonWidth: number;
    buttonColor: string;
  };
  hero: {
    paddingTop: number;
    heading: string;
    paragraph: string;
    buttonText: string;
    buttonRadius: number;
    buttonColor: string;
    showImage: boolean;
    // Present only on the website spec in the demo data — an unplanned
    // bit of copy with no Figma counterpart, to demonstrate "Extra Text".
    extraBadge?: string;
  };
  cards: {
    title: string;
    description: string | null;
    iconColor: string;
  }[];
  cta: {
    heading: string;
    backgroundColor: string;
    buttonText: string;
  };
  footer: {
    columnGap: number;
    columns: { heading: string; links: string[] }[];
  };
}

// ---- computed layout (shared math so SVG + elements always match) --------

const HEADER_H = 80;
const HERO_H = 440;
const FEATURES_H = 320;
const CTA_H = 160;
const FOOTER_H = 260;

export function layoutOf(spec: PageSpec) {
  const W = spec.canvasWidth;
  const heroY = HEADER_H;
  const featuresY = heroY + HERO_H;
  const ctaY = featuresY + FEATURES_H;
  const footerY = ctaY + CTA_H;

  const cardWidth = 360;
  const cardGap = (W - 240 - cardWidth * 3) / 2;
  const cardX = [120, 120 + cardWidth + cardGap, 120 + (cardWidth + cardGap) * 2];

  const footerColX: number[] = [];
  let cursor = 120;
  for (let i = 0; i < spec.footer.columns.length; i++) {
    footerColX.push(cursor);
    cursor += 180 + spec.footer.columnGap;
  }

  return {
    W,
    H: footerY + FOOTER_H,
    header: { x: 0, y: 0, w: W, h: HEADER_H },
    logo: { x: 48, y: 24, w: 120, h: 32 },
    navButton: { x: W - 48 - spec.nav.buttonWidth, y: 24, w: spec.nav.buttonWidth, h: 32 },
    hero: { x: 0, y: heroY, w: W, h: HERO_H, paddingTop: spec.hero.paddingTop },
    heroHeading: { x: 120, y: heroY + spec.hero.paddingTop, w: 520, h: 110 },
    heroParagraph: { x: 120, y: heroY + spec.hero.paddingTop + 120, w: 460, h: 56 },
    heroButton: { x: 120, y: heroY + spec.hero.paddingTop + 196, w: 190, h: 56 },
    heroImage: { x: 760, y: heroY + 80, w: 560, h: 320 },
    features: { x: 0, y: featuresY, w: W, h: FEATURES_H, gap: cardGap },
    cards: cardX.map((x) => ({ x, y: featuresY + 40, w: cardWidth, h: 240 })),
    cta: { x: 0, y: ctaY, w: W, h: CTA_H },
    footer: { x: 0, y: footerY, w: W, h: FOOTER_H, gap: spec.footer.columnGap },
    footerColumns: footerColX.map((x) => ({ x, y: footerY + 56, w: 180, h: 160 })),
  };
}

// ---- SVG rendering ---------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function renderPageSvg(spec: PageSpec): string {
  const L = layoutOf(spec);
  const isFigma = spec.source === "figma";
  const bodyText = "#181321";
  const mutedText = "#7A7288";
  const border = "#E7E3EE";

  const navLinks = spec.nav.links
    .map((link, i) => `<text x="${420 + i * 90}" y="46" font-size="14" fill="${bodyText}" font-family="${spec.fontFamily}">${esc(link)}</text>`)
    .join("");

  const heroBadgeSvg = spec.hero.extraBadge
    ? `<rect x="${L.heroHeading.x}" y="${L.heroHeading.y - 34}" width="180" height="28" rx="14" fill="#FDEEDB"/>
       <text x="${L.heroHeading.x + 16}" y="${L.heroHeading.y - 15}" font-size="12.5" font-weight="600" fill="#B5680A" font-family="${spec.fontFamily}">${esc(spec.hero.extraBadge)}</text>`
    : "";

  const heroHeadingLines = wrapText(spec.hero.heading, 22);
  const heroHeadingSvg = heroHeadingLines
    .map((line, i) => `<text x="${L.heroHeading.x}" y="${L.heroHeading.y + 44 + i * 54}" font-size="42" font-weight="700" fill="${bodyText}" font-family="${spec.fontFamily}">${esc(line)}</text>`)
    .join("");

  const heroParaLines = wrapText(spec.hero.paragraph, 52);
  const heroParaSvg = heroParaLines
    .map((line, i) => `<text x="${L.heroParagraph.x}" y="${L.heroParagraph.y + 22 + i * 26}" font-size="17" fill="${mutedText}" font-family="${spec.fontFamily}">${esc(line)}</text>`)
    .join("");

  const heroImageSvg = spec.hero.showImage
    ? `<rect x="${L.heroImage.x}" y="${L.heroImage.y}" width="${L.heroImage.w}" height="${L.heroImage.h}" rx="20" fill="#ECE6FB"/>
       <circle cx="${L.heroImage.x + 180}" cy="${L.heroImage.y + 120}" r="60" fill="#BCA5EF"/>
       <rect x="${L.heroImage.x + 260}" y="${L.heroImage.y + 60}" width="240" height="160" rx="14" fill="#9A75E5"/>
       <rect x="${L.heroImage.x + 60}" y="${L.heroImage.y + 210}" width="380" height="20" rx="10" fill="#D9CDF6"/>
       <rect x="${L.heroImage.x + 60}" y="${L.heroImage.y + 244}" width="260" height="20" rx="10" fill="#D9CDF6"/>`
    : "";

  const cardsSvg = spec.cards
    .map((card, i) => {
      const box = L.cards[i];
      const descLines = card.description ? wrapText(card.description, 34) : [];
      const descSvg = descLines
        .map((line, j) => `<text x="${box.x + 32}" y="${box.y + 168 + j * 22}" font-size="14.5" fill="${mutedText}" font-family="${spec.fontFamily}">${esc(line)}</text>`)
        .join("");
      return `
        <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="16" fill="#FFFFFF" stroke="${border}"/>
        <circle cx="${box.x + 56}" cy="${box.y + 56}" r="24" fill="${card.iconColor}"/>
        <text x="${box.x + 32}" y="${box.y + 126}" font-size="19" font-weight="600" fill="${bodyText}" font-family="${spec.fontFamily}">${esc(card.title)}</text>
        ${descSvg}`;
    })
    .join("");

  const footerSvg = L.footerColumns
    .map((box, i) => {
      const col = spec.footer.columns[i];
      const links = col.links
        .map((link, j) => `<text x="${box.x}" y="${box.y + 42 + j * 30}" font-size="14" fill="#B8B2C4" font-family="${spec.footerFontFamily}">${esc(link)}</text>`)
        .join("");
      return `
        <text x="${box.x}" y="${box.y}" font-size="15" font-weight="600" fill="#FFFFFF" font-family="${spec.footerFontFamily}">${esc(col.heading)}</text>
        ${links}`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}">
    <rect x="0" y="0" width="${L.W}" height="${L.H}" fill="#FFFFFF"/>

    <!-- header -->
    <rect x="${L.header.x}" y="${L.header.y}" width="${L.header.w}" height="${L.header.h}" fill="#FFFFFF"/>
    <line x1="0" y1="${HEADER_H}" x2="${L.W}" y2="${HEADER_H}" stroke="${border}"/>
    <text x="${L.logo.x}" y="46" font-size="21" font-weight="700" fill="${bodyText}" font-family="${spec.fontFamily}">${esc(spec.nav.logo)}</text>
    ${navLinks}
    <rect x="${L.navButton.x}" y="${L.navButton.y}" width="${L.navButton.w}" height="${L.navButton.h}" rx="8" fill="${spec.nav.buttonColor}"/>
    <text x="${L.navButton.x + L.navButton.w / 2}" y="45" font-size="13.5" fill="#FFFFFF" text-anchor="middle" font-family="${spec.fontFamily}">${esc(spec.nav.buttonText)}</text>

    <!-- hero -->
    <rect x="${L.hero.x}" y="${L.hero.y}" width="${L.hero.w}" height="${L.hero.h}" fill="#FAF9FC"/>
    ${heroBadgeSvg}
    ${heroHeadingSvg}
    ${heroParaSvg}
    <rect x="${L.heroButton.x}" y="${L.heroButton.y}" width="${L.heroButton.w}" height="${L.heroButton.h}" rx="${spec.hero.buttonRadius}" fill="${spec.hero.buttonColor}"/>
    <text x="${L.heroButton.x + L.heroButton.w / 2}" y="${L.heroButton.y + 34}" font-size="15.5" fill="#FFFFFF" text-anchor="middle" font-family="${spec.fontFamily}">${esc(spec.hero.buttonText)}</text>
    ${heroImageSvg}

    <!-- features -->
    ${cardsSvg}

    <!-- cta -->
    <rect x="${L.cta.x}" y="${L.cta.y}" width="${L.cta.w}" height="${L.cta.h}" fill="${spec.cta.backgroundColor}"/>
    <text x="${L.W / 2}" y="${L.cta.y + 62}" font-size="28" font-weight="700" fill="#FFFFFF" text-anchor="middle" font-family="${spec.fontFamily}">${esc(spec.cta.heading)}</text>
    <rect x="${L.W / 2 - 90}" y="${L.cta.y + 92}" width="180" height="52" rx="10" fill="#FFFFFF"/>
    <text x="${L.W / 2}" y="${L.cta.y + 124}" font-size="15" fill="${spec.cta.backgroundColor}" text-anchor="middle" font-family="${spec.fontFamily}">${esc(spec.cta.buttonText)}</text>

    <!-- footer -->
    <rect x="${L.footer.x}" y="${L.footer.y}" width="${L.footer.w}" height="${L.footer.h}" fill="#181321"/>
    ${footerSvg}
    <text x="120" y="${L.footer.y + L.footer.h - 32}" font-size="13" fill="#6E6780" font-family="${spec.footerFontFamily}">© 2026 ${esc(spec.nav.logo)}. All rights reserved. (${isFigma ? "Figma design" : "Live website"})</text>
  </svg>`;
}

export function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

// ---- DesignElement extraction (shares the same layout math as the SVG) ---

let counter = 0;
function elId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function pageSpecToElements(spec: PageSpec): DesignElement[] {
  const L = layoutOf(spec);
  const src = spec.source;
  const els: DesignElement[] = [];

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  const push = (
    type: ElementType,
    name: string,
    section: string,
    box: { x: number; y: number; w: number; h: number },
    extra: Partial<DesignElement> = {}
  ) => {
    els.push({
      id: elId(src),
      source: src,
      type,
      name,
      section,
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      selector: src === "website" ? `[data-qa="${slugify(name)}"]` : undefined,
      ...extra,
    });
  };

  push("section", "Header", "Header", L.header);
  push("text", "Logo", "Header", L.logo, { text: spec.nav.logo, fontFamily: spec.fontFamily, fontSize: 21, fontWeight: 700, color: "#181321" });
  push("button", "Nav CTA Button", "Header", L.navButton, {
    text: spec.nav.buttonText,
    fontFamily: spec.fontFamily,
    fontSize: 13.5,
    backgroundColor: spec.nav.buttonColor,
    color: "#FFFFFF",
    borderRadius: 8,
  });

  push("section", "Hero Section", "Hero", L.hero, { paddingTop: spec.hero.paddingTop });
  if (spec.hero.extraBadge) {
    push(
      "text",
      "Hero Badge",
      "Hero",
      { x: L.heroHeading.x, y: L.heroHeading.y - 34, w: 180, h: 28 },
      { text: spec.hero.extraBadge, fontFamily: spec.fontFamily, fontSize: 12.5, fontWeight: 600, color: "#B5680A" }
    );
  }
  push("heading", "Hero Heading", "Hero", L.heroHeading, {
    text: spec.hero.heading,
    fontFamily: spec.fontFamily,
    fontSize: 42,
    fontWeight: 700,
    color: "#181321",
  });
  push("paragraph", "Hero Paragraph", "Hero", L.heroParagraph, {
    text: spec.hero.paragraph,
    fontFamily: spec.fontFamily,
    fontSize: 17,
    fontWeight: 400,
    color: "#7A7288",
  });
  push("button", "Hero CTA Button", "Hero", L.heroButton, {
    text: spec.hero.buttonText,
    fontFamily: spec.fontFamily,
    fontSize: 15.5,
    backgroundColor: spec.hero.buttonColor,
    color: "#FFFFFF",
    borderRadius: spec.hero.buttonRadius,
  });
  if (spec.hero.showImage) {
    push("image", "Hero Illustration", "Hero", L.heroImage, { imageUrl: "hero-illustration.svg" });
  }

  push("section", "Features", "Features", L.features, { gap: L.features.gap });
  spec.cards.forEach((card, i) => {
    const box = L.cards[i];
    const section = `Feature Card ${i + 1}`;
    push("component", `Feature Card ${i + 1}`, section, box);
    push("icon", `Feature Icon ${i + 1}`, section, { x: box.x + 32, y: box.y + 32, w: 48, h: 48 }, { backgroundColor: card.iconColor });
    push("heading", `Feature Title ${i + 1}`, section, { x: box.x + 32, y: box.y + 104, w: box.w - 64, h: 28 }, {
      text: card.title,
      fontFamily: spec.fontFamily,
      fontSize: 19,
      fontWeight: 600,
      color: "#181321",
    });
    if (card.description) {
      push("paragraph", `Feature Text ${i + 1}`, section, { x: box.x + 32, y: box.y + 140, w: box.w - 64, h: 60 }, {
        text: card.description,
        fontFamily: spec.fontFamily,
        fontSize: 14.5,
        fontWeight: 400,
        color: "#7A7288",
      });
    }
  });

  push("section", "CTA Banner", "CTA Banner", L.cta, { backgroundColor: spec.cta.backgroundColor });
  push("heading", "CTA Heading", "CTA Banner", { x: L.cta.x + L.cta.w / 2 - 260, y: L.cta.y + 34, w: 520, h: 44 }, {
    text: spec.cta.heading,
    fontFamily: spec.fontFamily,
    fontSize: 28,
    fontWeight: 700,
    color: "#FFFFFF",
  });
  push("button", "CTA Button", "CTA Banner", { x: L.W / 2 - 90, y: L.cta.y + 92, w: 180, h: 52 }, {
    text: spec.cta.buttonText,
    fontFamily: spec.fontFamily,
    fontSize: 15,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
  });

  push("section", "Footer", "Footer", L.footer, { gap: spec.footer.columnGap });
  spec.footer.columns.forEach((col, i) => {
    const box = L.footerColumns[i];
    push("component", `Footer Column: ${col.heading}`, "Footer", box);
  });
  push("text", "Footer Copyright", "Footer", { x: 120, y: L.footer.y + L.footer.h - 40, w: 420, h: 20 }, {
    text: `© 2026 ${spec.nav.logo}. All rights reserved.`,
    fontFamily: spec.footerFontFamily,
    fontSize: 13,
    fontWeight: 400,
    color: "#6E6780",
  });

  return els;
}
