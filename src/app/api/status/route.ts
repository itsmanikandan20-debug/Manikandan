import { NextResponse } from "next/server";
import { getMissingEnvVars } from "@/lib/env";

export async function GET() {
  const missing = getMissingEnvVars();
  return NextResponse.json({ configured: missing.length === 0, missing });
}
