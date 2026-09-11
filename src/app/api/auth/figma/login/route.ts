import { NextResponse } from "next/server";
import { buildAuthorizeUrl, generateState, isFigmaOAuthConfigured } from "@/lib/figma-oauth";
import { buildStateCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  if (!isFigmaOAuthConfigured()) {
    return NextResponse.redirect(`${origin}/?figma_error=not_configured`);
  }

  const state = generateState();
  const res = NextResponse.redirect(buildAuthorizeUrl(origin, state));
  res.headers.append("Set-Cookie", buildStateCookie(state));
  return res;
}
