import { NextResponse } from "next/server";
import { getServerConfig } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getServerConfig());
}
