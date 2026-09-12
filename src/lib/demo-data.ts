import type { AnalysisResult } from "./types";
import { VIEWPORTS } from "./types";
import { buildDemoFigma } from "./demo-figma";
import { buildDemoWebsite } from "./demo-website";
import { buildDemoResponsive } from "./demo-responsive";
import { matchElements } from "./matcher";
import { compareDesignToWebsite, detectUxIssues, numberIssues } from "./compare";
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
