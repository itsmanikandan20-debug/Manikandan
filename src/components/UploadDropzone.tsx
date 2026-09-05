"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, ImageUp, Loader2 } from "lucide-react";

type Phase = "idle" | "dragging" | "selected" | "analyzing";

export function UploadDropzone() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreviewUrl(URL.createObjectURL(file));
    setPhase("selected");
  }, []);

  const runAnalysis = useCallback(() => {
    setPhase("analyzing");
    // Mock analysis delay — in production this is where the vision API call happens.
    setTimeout(() => {
      router.push("/results");
    }, 1400);
  }, [router]);

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
          {fileName ? "Ready to analyze" : "PNG or JPG, up to 20MB"}
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
          accept="image/png, image/jpeg"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <p className="mt-3 text-center text-xs text-ink-muted">
        Analysis runs on mock data in this preview build — no image is uploaded anywhere.
      </p>
    </div>
  );
}
