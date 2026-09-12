import { NextResponse } from "next/server";
import type { AnalyzeRequestBody, AnalysisResult } from "@/lib/types";
import { VIEWPORTS } from "@/lib/types";
import { getServerConfig } from "@/lib/env";
import { getSession, buildSessionCookie } from "@/lib/session";
import { getValidAccessToken, FigmaOAuthError } from "@/lib/figma-oauth";
import { fetchFigmaExtraction, FigmaApiError } from "@/lib/figma-api";
import { analyzeWebsite, WebsiteAnalysisError } from "@/lib/website-analyzer";
import { matchElements } from "@/lib/matcher";
import { compareDesignToWebsite, detectUxIssues, numberIssues } from "@/lib/compare";
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
          'Figma sign-in isn\'t set up on this server yet (FIGMA_CLIENT_ID / FIGMA_CLIENT_SECRET are missing). Click "Try Demo" to see DesignCheck with sample data in the meantime.',
        code: "FIGMA_NOT_CONFIGURED",
      },
      { status: 400 }
    );
  }

  // Every designer analyzes their own Figma file using their own
  // connected account — never a token shared across users.
  const session = getSession(req);
  if (!session) {
    return NextResponse.json(
      {
        error: 'Connect your Figma account first — click "Connect Figma" above, then try again.',
        code: "FIGMA_NOT_CONNECTED",
      },
      { status: 401 }
    );
  }

  let accessToken: string;
  let refreshedSession;
  try {
    const result = await getValidAccessToken(session);
    accessToken = result.accessToken;
    refreshedSession = result.refreshedSession;
  } catch (err) {
    const message = err instanceof FigmaOAuthError ? err.message : "Your Figma connection expired.";
    return NextResponse.json({ error: message, code: "FIGMA_NOT_CONNECTED" }, { status: 401 });
  }

  try {
    const [figma, website] = await Promise.all([
      fetchFigmaExtraction(figmaUrl, accessToken),
      analyzeWebsite(websiteUrl, viewport),
    ]);

    const matches = matchElements(figma.elements, website.elements, figma.frameWidth);
    const page = figma.frameName || "Home";
    const issues = numberIssues([
      ...compareDesignToWebsite(figma, website, matches, page),
      ...detectUxIssues(website, page),
    ]);

    const explanations = await explainIssuesWithAI(issues);
    for (const issue of issues) {
      if (explanations[issue.id]) issue.aiExplanation = explanations[issue.id];
    }

    const { overallScore, categoryScores } = computeScores(issues);

    const warnings: string[] = [];
    if (website.botChallengeDetected) {
      warnings.push(
        "This website appears to be protected by bot-detection (e.g. Cloudflare) that showed our automated browser a \"verifying you're human\" page instead of the real site. The screenshot and issues below reflect that challenge page, not your actual website — this comparison won't be accurate. Sites with this kind of protection generally can't be analyzed this way."
      );
    }
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

    const res = NextResponse.json(result);
    if (refreshedSession) res.headers.append("Set-Cookie", buildSessionCookie(refreshedSession));
    return res;
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
