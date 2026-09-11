import type { AnalysisResult } from "./types";
import { VIEWPORTS } from "./types";
import { buildDemoFigma } from "./demo-figma";
import { buildDemoWebsite } from "./demo-website";
import { buildDemoResponsive } from "./demo-responsive";
import { matchElements } from "./matcher";
import { compareDesignToWebsite, detectUxIssues, createIssue, numberIssues } from "./compare";
import { computeScores } from "./scoring";
import { makeId } from "./id";

/**
 * Builds the full Demo Mode analysis result. Nothing here is hard-coded
 * as a fake "results" object — the demo Figma and website element data
 * (demo-figma.ts / demo-website.ts) is run through the exact same
 * matching, comparison, and scoring engine that real analyses use. That's
 * what makes it a fair demonstration of how the tool actually works.
 */
export function buildDemoAnalysis(): AnalysisResult {
  const figma = buildDemoFigma();
  const website = buildDemoWebsite(VIEWPORTS[0]);
  const page = "Home";

  const matches = matchElements(figma.elements, website.elements, figma.frameWidth);
  const issues = [
    ...compareDesignToWebsite(figma, website, matches, page),
    ...detectUxIssues(website, page),
  ];

  // One hand-authored accessibility issue — not every UX check can be
  // derived from a Figma diff (this one comes from reading the rendered
  // CSS, which the real Playwright analyzer does; here we illustrate it).
  const footerColumn = website.elements.find((e) => e.name === "Footer Column: Company");
  issues.push(
    createIssue({
      category: "ux",
      severity: "low",
      title: "Footer links have no visible focus state",
      section: "Footer",
      page,
      description:
        "Keyboard users tabbing through the footer links get no visible outline or style change, making it hard to tell which link is focused.",
      expected: "A visible focus ring or underline on :focus-visible",
      actual: "No style change on focus",
      difference: "Missing focus indicator",
      correction: "Add a visible :focus-visible outline or underline to footer links.",
      matchConfidence: null,
      websiteElementId: footerColumn?.id,
      websiteSelector: footerColumn?.selector,
      boundingBox: footerColumn ? { x: footerColumn.x, y: footerColumn.y, width: footerColumn.width, height: footerColumn.height } : undefined,
    })
  );

  const numberedIssues = numberIssues(issues);
  const { overallScore, categoryScores } = computeScores(numberedIssues);

  return {
    id: makeId("demo"),
    createdAt: new Date().toISOString(),
    figmaUrl: "https://www.figma.com/design/demo1234/Brandly-Marketing-Site",
    websiteUrl: website.url,
    viewport: VIEWPORTS[0],
    isDemo: true,
    figma,
    website,
    matches,
    issues: numberedIssues,
    overallScore,
    categoryScores,
    responsive: buildDemoResponsive(),
    warnings: [],
  };
}
