"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, ImageUp, Loader2, AlertTriangle } from "lucide-react";
import { saveLastSearch, appendHistory } from "@/lib/search-store";
import type { SearchRecord } from "@/lib/types";

type Phase = "idle" | "dragging" | "selected" | "analyzing" | "error";

export function UploadDropzone() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFiles = useCallback((files: FileList | null) => {
    const selected = files?.[0];
    if (!selected) return;
    setFile(selected);
    setFileName(selected.name);
    setPreviewUrl(URL.createObjectURL(selected));
    setPhase("selected");
    setErrorMessage(null);
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!file) return;
    setPhase("analyzing");
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok) {
        if (json?.error === "not_configured") {
          const missing = Array.isArray(json.missing) ? json.missing.join(", ") : "API keys";
          throw new Error(
            `Real analysis isn't set up yet (missing: ${missing}). Add them to .env.local and restart the app — see README.md.`
          );
        }
        throw new Error(json?.message ?? "Analysis failed. Please try again.");
      }

      const record = json.record as SearchRecord;
      saveLastSearch(record);
      appendHistory(record);
      router.push("/results");
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }, [file, router]);

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setPhase("dragging");
        }}
        onDragLeave={() => setPhase(fileName ? "selected" : "idle")}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
          phase === "dragging"
            ? "border-violet-400 bg-violet-50"
            : phase === "error"
              ? "border-red-300 bg-red-50/40"
              : "border-border-strong bg-surface-sunken hover:border-violet-300 hover:bg-violet-50/40"
        }`}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Uploaded design preview"
            className="mb-5 h-40 w-auto rounded-xl border border-border object-cover shadow-panel"
          />
        ) : (
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
            <UploadCloud className="h-7 w-7" strokeWidth={1.75} />
          </div>
        )}

        <p className="text-sm font-medium text-ink">
          {fileName ?? "Drag your Figma screenshot here"}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          {phase === "analyzing"
            ? "Analyzing with Gemini Vision + reverse image search…"
            : fileName
              ? "Ready to analyze"
              : "PNG, JPG, or WEBP, up to 4MB"}
        </p>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-ink-soft shadow-sm hover:bg-surface-sunken"
          >
            <ImageUp className="h-4 w-4" />
            {fileName ? "Choose a different file" : "Browse files"}
          </button>

          {fileName ? (
            <button
              type="button"
              onClick={runAnalysis}
              disabled={phase === "analyzing"}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-pop hover:bg-violet-700 disabled:opacity-70"
            >
              {phase === "analyzing" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing design…
                </>
              ) : (
                "Find similar websites"
              )}
            </button>
          ) : null}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png, image/jpeg, image/webp"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {phase === "error" && errorMessage ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : (
        <p className="mt-3 text-center text-xs text-ink-muted">
          Your screenshot is sent to Gemini Vision and a reverse-image search API to find real live websites.
        </p>
      )}
    </div>
  );
}
