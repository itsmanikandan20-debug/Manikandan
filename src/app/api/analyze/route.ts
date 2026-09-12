import { NextResponse } from "next/server";
import type { AnalyzeRequestBody, AnalysisResult, FigmaExtraction } from "@/lib/types";
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

  const { figmaUrl, figmaExtraction: uploadedFigma, websiteUrl, viewportIndex, checkResponsive } = body;
  const viewport = VIEWPORTS[viewportIndex] ?? VIEWPORTS[0];

  if (!websiteUrl?.trim()) {
    return NextResponse.json({ error: "A live website URL is required." }, { status: 400 });
  }
  if (!figmaUrl?.trim() && !uploadedFigma) {
    return NextResponse.json({ error: "Provide a Figma URL or upload an SVG export of your design." }, { status: 400 });
  }

  // Two ways to provide the design: a signed-in designer's own Figma URL
  // (needs FIGMA_CLIENT_ID/SECRET configured + that designer's session),
  // or an SVG already parsed client-side from an upload — which needs
  // neither, since no Figma API call happens on that path at all.
  let refreshedSession = null;
  let getFigma: () => Promise<FigmaExtraction>;

  if (uploadedFigma) {
    getFigma = async () => uploadedFigma;
  } else {
    const { figmaConfigured } = getServerConfig();
    if (!figmaConfigured) {
      return NextResponse.json(
        {
          error:
            'Figma sign-in isn\'t set up on this server yet (FIGMA_CLIENT_ID / FIGMA_CLIENT_SECRET are missing). Click "Try Demo" to see DesignCheck with sample data, or upload an SVG export instead.',
          code: "FIGMA_NOT_CONFIGURED",
        },
        { status: 400 }
      );
    }

    const session = getSession(req);
    if (!session) {
      return NextResponse.json(
        {
          error: 'Connect your Figma account first — click "Connect Figma" above, then try again. Or upload an SVG export instead, which needs no Figma connection.',
          code: "FIGMA_NOT_CONNECTED",
        },
        { status: 401 }
      );
    }

    let accessToken: string;
    try {
      const result = await getValidAccessToken(session);
      accessToken = result.accessToken;
      refreshedSession = result.refreshedSession;
    } catch (err) {
      const message = err instanceof FigmaOAuthError ? err.message : "Your Figma connection expired.";
      return NextResponse.json({ error: message, code: "FIGMA_NOT_CONNECTED" }, { status: 401 });
    }

    getFigma = () => fetchFigmaExtraction(figmaUrl!, accessToken);
  }

  try {
    const [figma, website] = await Promise.all([getFigma(), analyzeWebsite(websiteUrl, viewport)]);

    const matchResult = matchElements(figma.elements, website.elements, figma.frameWidth);
    const page = figma.frameName || "Home";
    const issues = numberIssues([
      ...compareDesignToWebsite(figma, website, matchResult, page),
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
    if (uploadedFigma) {
      warnings.push(
        "Design source: uploaded SVG. Auto Layout spacing/gap checks don't apply to SVG-sourced designs (that data isn't present in an SVG export) — everything else (text, color, size, position) is compared normally."
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
      figmaUrl: figmaUrl || `SVG upload: ${figma.fileName}`,
      websiteUrl,
      viewport,
      isDemo: false,
      figma,
      website,
      matches: matchResult.pairs,
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
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Something went wrong during analysis: ${detail}. Please try again.` },
      { status: 500 }
    );
  }
}
