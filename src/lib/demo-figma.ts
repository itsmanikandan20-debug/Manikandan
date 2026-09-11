import type { PageSpec } from "./mock-page";
import { pageSpecToElements, renderPageSvg, svgToDataUrl } from "./mock-page";
import type { FigmaExtraction } from "./types";

// The "intended design" half of the demo — deliberately paired with
// demo-website.ts so every difference between the two tells one of the
// demo's planted issues (button text, missing image, spacing, color,
// border radius, etc). See mock-page.ts for how the SVG and the element
// bounding boxes are generated from the same numbers.
export const demoFigmaSpec: PageSpec = {
  source: "figma",
  canvasWidth: 1440,
  canvasHeight: 1400,
  fontFamily: "Inter",
  footerFontFamily: "Inter",
  nav: {
    logo: "Brandly",
    links: ["Product", "Pricing", "About", "Contact"],
    buttonText: "Sign Up",
    buttonWidth: 132,
    buttonColor: "#6931CC",
  },
  hero: {
    paddingTop: 64,
    heading: "Design Faster, Ship Sooner",
    paragraph: "Catch every visual difference between your Figma design and the live build, automatically.",
    buttonText: "Get Started",
    buttonRadius: 12,
    buttonColor: "#6931CC",
    showImage: true,
  },
  cards: [
    { title: "Fast Setup", description: "Paste two URLs and get results in under a minute.", iconColor: "#6931CC" },
    { title: "Pixel Matching", description: "We compare position, size, spacing, and color automatically.", iconColor: "#6931CC" },
    { title: "Clear Reports", description: "Export a developer-ready QA report with one click.", iconColor: "#6931CC" },
  ],
  cta: {
    heading: "Ready to ship pixel-perfect?",
    backgroundColor: "#6931CC",
    buttonText: "Try it Free",
  },
  footer: {
    columnGap: 60,
    columns: [
      { heading: "Product", links: ["Features", "Pricing", "Changelog"] },
      { heading: "Company", links: ["About", "Careers", "Blog"] },
      { heading: "Resources", links: ["Docs", "Support", "Status"] },
      { heading: "Legal", links: ["Privacy", "Terms", "Security"] },
    ],
  },
};

export function buildDemoFigma(): FigmaExtraction {
  const svg = renderPageSvg(demoFigmaSpec);
  return {
    fileKey: "demo-figma-file",
    fileName: "Brandly — Marketing Site",
    pageName: "Landing Page",
    frameName: "Desktop / Home",
    frameWidth: demoFigmaSpec.canvasWidth,
    frameHeight: demoFigmaSpec.canvasHeight,
    thumbnailUrl: svgToDataUrl(svg),
    elements: pageSpecToElements(demoFigmaSpec),
    isDemo: true,
  };
}
