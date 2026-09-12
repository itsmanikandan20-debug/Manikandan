import type { PageSpec } from "./mock-page";
import { pageSpecToElements, renderPageSvg, svgToDataUrl } from "./mock-page";
import type { WebsiteExtraction, Viewport } from "./types";
import { VIEWPORTS } from "./types";

// The "as-implemented" half of the demo. Every field that differs from
// demo-figma.ts corresponds to exactly one planted issue the tool is
// meant to catch:
//  - hero button text ("Content")
//  - missing hero image ("Images")
//  - CTA banner color, feature icon #2 color ("Colors" / "Icons")
//  - feature card #3 missing description ("Content")
//  - extra hero badge text not in the Figma design ("Extra Text")
//  - broken footer link, non-functional newsletter button, form with no
//    submit control ("Links" / "Buttons" / "Forms")
// Some fields (nav button width, hero top padding, footer font family,
// footer spacing, button border radius) still differ between the two
// specs but are deliberately left alone — this tool no longer reports
// spacing/font-size/border-radius nitpicks, so these are just inert
// leftover variety in the mock data, not planted issues anymore.
export const demoWebsiteSpec: PageSpec = {
  source: "website",
  canvasWidth: 1440,
  canvasHeight: 1400,
  fontFamily: "Inter",
  footerFontFamily: "Arial",
  nav: {
    logo: "Brandly",
    links: ["Product", "Pricing", "About", "Contact"],
    buttonText: "Sign Up",
    buttonWidth: 104,
    buttonColor: "#6931CC",
  },
  hero: {
    paddingTop: 48,
    heading: "Design Faster, Ship Sooner",
    paragraph: "Catch every visual difference between your Figma design and the live build, automatically.",
    buttonText: "Start Now",
    buttonRadius: 4,
    buttonColor: "#6931CC",
    showImage: false,
    extraBadge: "New!",
  },
  cards: [
    { title: "Fast Setup", description: "Paste two URLs and get results in under a minute.", iconColor: "#6931CC" },
    { title: "Pixel Matching", description: "We compare position, size, spacing, and color automatically.", iconColor: "#9A9A9A" },
    { title: "Clear Reports", description: null, iconColor: "#6931CC" },
  ],
  cta: {
    heading: "Ready to ship pixel-perfect?",
    backgroundColor: "#2F6FED",
    buttonText: "Try it Free",
  },
  footer: {
    columnGap: 16,
    columns: [
      { heading: "Product", links: ["Features", "Pricing", "Changelog"] },
      { heading: "Company", links: ["About", "Careers", "Blog"] },
      { heading: "Resources", links: ["Docs", "Support", "Status"] },
      { heading: "Legal", links: ["Privacy", "Terms", "Security"] },
    ],
  },
};

export function buildDemoWebsite(viewport?: Viewport): WebsiteExtraction {
  const svg = renderPageSvg(demoWebsiteSpec);
  return {
    url: "https://brandly-demo.example.com",
    finalUrl: "https://brandly-demo.example.com/",
    viewport: viewport ?? VIEWPORTS[0],
    screenshotDataUrl: svgToDataUrl(svg),
    elements: pageSpecToElements(demoWebsiteSpec),
    brokenLinks: ["https://brandly-demo.example.com/careers (404 Not Found)"],
    brokenImages: [],
    brokenButtons: ["Newsletter Subscribe"],
    brokenForms: ["Newsletter signup form"],
    isDemo: true,
  };
}
