import { NextResponse } from "next/server";
import type { AnalyzeRequestBody, AnalysisResult } from "@/lib/types";
import { VIEWPORTS } from "@/lib/types";
import { getServerConfig } from "@/lib/env";
import { fetchFigmaExtraction, FigmaApiError } from "@/lib/figma-api";
import { analyzeWebsite, WebsiteAnalysisError } from "@/lib/website-analyzer";
import { matchElements } from "@/lib/matcher";
import { compareDesignToWebsite, detectUxIssues, resetIssueNumbering } from "@/lib/compare";
import { computeScores } from "@/lib/scoring";
import { checkAllResponsiveViewports } from "@/lib/responsive-check";
import { explainIssuesWithAI } from "@/lib/ai-explain";
import { makeId } from "@/lib/id";

// Playwright needs a real Node.js runtime (not the Edge runtime), and a
// real analysis (Figma fetch + headless browser + optional responsive
// pass) can take a while — give it the most headroom Vercel allows.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: AnalyzeRequestBody;
  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { figmaUrl, websiteUrl, viewportIndex, checkResponsive } = body;
  const viewport = VIEWPORTS[viewportIndex] ?? VIEWPORTS[0];

  if (!figmaUrl?.trim() || !websiteUrl?.trim()) {
    return NextResponse.json({ error: "Both a Figma URL and a website URL are required." }, { status: 400 });
  }

  const { figmaConfigured } = getServerConfig();
  if (!figmaConfigured) {
    return NextResponse.json(
      {
        error:
          "Live analysis needs a Figma API token configured on the server (FIGMA_TOKEN in .env.local). Add one, or click \"Try Demo\" to see DesignCheck with sample data.",
        code: "FIGMA_NOT_CONFIGURED",
      },
      { status: 400 }
    );
  }

  try {
    resetIssueNumbering();

    const [figma, website] = await Promise.all([
      fetchFigmaExtraction(figmaUrl, process.env.FIGMA_TOKEN!),
      analyzeWebsite(websiteUrl, viewport),
    ]);

    const matches = matchElements(figma.elements, website.elements, figma.frameWidth);
    const page = figma.frameName || "Home";
    const issues = [
      ...compareDesignToWebsite(figma, website, matches, page),
      ...detectUxIssues(website, page),
    ];

    const explanations = await explainIssuesWithAI(issues);
    for (const issue of issues) {
      if (explanations[issue.id]) issue.aiExplanation = explanations[issue.id];
    }

    const { overallScore, categoryScores } = computeScores(issues);

    const warnings: string[] = [];
    if (Math.abs(figma.frameWidth - viewport.width) > 40) {
      warnings.push(
        `The selected Figma frame is ${figma.frameWidth}px wide, but you're comparing against a ${viewport.width}px website viewport. For the most accurate comparison, pick a Figma frame that matches your chosen viewport width.`
      );
    }

    let responsive: AnalysisResult["responsive"] = [];
    if (checkResponsive) {
      const otherViewports = VIEWPORTS.filter((v) => v.width !== viewport.width);
      responsive = await checkAllResponsiveViewports(website.url, otherViewports);
    }

    const result: AnalysisResult = {
      id: makeId("analysis"),
      createdAt: new Date().toISOString(),
      figmaUrl,
      websiteUrl,
      viewport,
      isDemo: false,
      figma,
      website,
      matches,
      issues,
      overallScore,
      categoryScores,
      responsive,
      warnings,
    };

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FigmaApiError) {
      return NextResponse.json({ error: err.message, code: "FIGMA_ERROR" }, { status: 400 });
    }
    if (err instanceof WebsiteAnalysisError) {
      return NextResponse.json({ error: err.message, code: "WEBSITE_ERROR" }, { status: 400 });
    }
    console.error("Analyze failed:", err);
    return NextResponse.json(
      { error: "Something went wrong during analysis. Please try again." },
      { status: 500 }
    );
  }
}
