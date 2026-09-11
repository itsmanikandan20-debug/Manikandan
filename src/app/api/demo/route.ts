import { NextResponse } from "next/server";
import { buildDemoAnalysis } from "@/lib/demo-data";

export const runtime = "nodejs";

export async function GET() {
  const result = buildDemoAnalysis();
  return NextResponse.json(result);
}
