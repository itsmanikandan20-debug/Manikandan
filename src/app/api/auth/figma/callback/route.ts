import { NextResponse } from "next/server";
import { exchangeCodeForToken, fetchFigmaMe, FigmaOAuthError } from "@/lib/figma-oauth";
import { buildClearStateCookie, buildSessionCookie, readStateCookie, type FigmaSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    // The designer clicked "Cancel" on Figma's permission screen.
    return NextResponse.redirect(`${origin}/?figma_error=denied`);
  }

  const expectedState = readStateCookie(req);
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${origin}/?figma_error=state_mismatch`);
  }

  try {
    const token = await exchangeCodeForToken(origin, code);
    const me = await fetchFigmaMe(token.access_token);

    const session: FigmaSession = {
      figmaUserId: me.id,
      handle: me.handle,
      email: me.email,
      avatarUrl: me.img_url,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };

    const res = NextResponse.redirect(`${origin}/?connected=1`);
    res.headers.append("Set-Cookie", buildSessionCookie(session));
    res.headers.append("Set-Cookie", buildClearStateCookie());
    return res;
  } catch (err) {
    const message = err instanceof FigmaOAuthError ? err.message : "Something went wrong connecting to Figma.";
    return NextResponse.redirect(`${origin}/?figma_error=${encodeURIComponent(message)}`);
  }
}
