import { NextResponse } from "next/server";
import { getMissingEnvVars } from "@/lib/env";
import { uploadImageForSearch } from "@/lib/image-host";
import { analyzeDesignWithGemini } from "@/lib/vision";
import { findVisualMatches } from "@/lib/reverse-image-search";
import { buildMatchResults } from "@/lib/build-results";
import type { SearchRecord, UploadedDesign } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel serverless functions cap request body size well under this on
// some plans/regions — see README "Known limitations" if uploads fail.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function POST(request: Request) {
  const missing = getMissingEnvVars();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "not_configured",
        message: "Real analysis isn't set up yet. Add the required API keys to .env.local and restart the app.",
        missing,
      },
      { status: 503 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Could not read the upload." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "bad_request", message: "No file was uploaded." }, { status: 400 });
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "bad_request", message: "Only PNG, JPG, or WEBP screenshots are supported." },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "bad_request", message: "Image is too large. Please upload a screenshot under 4MB." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  try {
    const [hostedUrl, analysis] = await Promise.all([
      uploadImageForSearch(buffer, file.type),
      analyzeDesignWithGemini(base64, file.type),
    ]);

    const rawMatches = await findVisualMatches(hostedUrl);
    const results = await buildMatchResults(rawMatches);

    const design: UploadedDesign = {
      id: `upload-${Date.now()}`,
      fileName: file.name,
      imageUrl: hostedUrl,
      uploadedAt: new Date().toISOString(),
      dominantColors: analysis.dominantColors,
      detectedLayout: analysis.detectedLayout,
    };

    const record: SearchRecord = {
      id: `search-${Date.now()}`,
      design,
      results,
      createdAt: new Date().toISOString(),
      status: results.length > 0 ? "completed" : "no_matches",
    };

    return NextResponse.json({ record });
  } catch (err) {
    console.error("Design analysis failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error during analysis.";
    return NextResponse.json({ error: "upstream_failed", message }, { status: 502 });
  }
}
