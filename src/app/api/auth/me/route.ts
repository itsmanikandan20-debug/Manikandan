import { NextResponse } from "next/server";
import { getSession, buildSessionCookie } from "@/lib/session";
import { getValidAccessToken } from "@/lib/figma-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ connected: false });
  }

  try {
    const { refreshedSession } = await getValidAccessToken(session);
    const current = refreshedSession ?? session;

    const res = NextResponse.json({
      connected: true,
      handle: current.handle,
      email: current.email ?? null,
      avatarUrl: current.avatarUrl ?? null,
    });
    if (refreshedSession) {
      res.headers.append("Set-Cookie", buildSessionCookie(refreshedSession));
    }
    return res;
  } catch {
    // Refresh failed — the connection is no longer valid.
    return NextResponse.json({ connected: false });
  }
}
