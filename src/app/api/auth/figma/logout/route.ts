import { NextResponse } from "next/server";
import { buildClearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", buildClearSessionCookie());
  return res;
}
