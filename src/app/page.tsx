"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Figma, Globe2, Sparkles, ArrowRight, AlertCircle } from "lucide-react";
import { ViewportSelect } from "@/components/ViewportSelect";
import { ProgressSteps, type ProgressStep } from "@/components/ProgressSteps";
import { saveAnalysis } from "@/lib/storage";
import type { AnalysisResult } from "@/lib/types";

const STEP_LABELS = [
  "Reading the Figma design",
  "Opening the live website",
  "Matching design elements to the page",
  "Comparing visuals, content, layout & UX",
  "Scoring the results",
];

export default function LandingPage() {
  const router = useRouter();
  const [figmaUrl, setFigmaUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [viewportIndex, setViewportIndex] = useState(0);
  const [checkResponsive, setCheckResponsive] = useState(false);

  const [status, setStatus] = useState<{ figmaConfigured: boolean; geminiConfigured: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const stopStepper = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const goToResult = (result: AnalysisResult) => {
    saveAnalysis(result);
    router.push(`/results/${result.id}`);
  };

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!figmaUrl.trim() || !websiteUrl.trim()) {
      setError("Please enter both a Figma URL and a live website URL.");
      return;
    }

    setLoading(true);
    setActiveStep(0);
    let step = 0;
    timerRef.current = setInterval(() => {
      step = Math.min(step + 1, STEP_LABELS.length - 1);
      setActiveStep(step);
    }, 2200);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figmaUrl, websiteUrl, viewportIndex, checkResponsive }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Analysis failed. Please try again.");
        return;
      }
      stopStepper();
      setActiveStep(STEP_LABELS.length - 1);
      goToResult(data as AnalysisResult);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      stopStepper();
      setLoading(false);
    }
  }

  async function handleDemo() {
    setDemoLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/demo");
      const data = await res.json();
      goToResult(data as AnalysisResult);
    } catch {
      setError("Couldn't load the demo. Please try again.");
    } finally {
      setDemoLoading(false);
    }
  }

  const steps: ProgressStep[] = STEP_LABELS.map((label, i) => ({
    label,
    status: i < activeStep ? "done" : i === activeStep ? "active" : "pending",
  }));

  return (
    <main className="mx-auto max-w-content px-6 py-14 lg:px-10">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
          <Sparkles size={13} /> Figma-to-Live Website QA
        </span>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">DesignCheck</h1>
        <p className="mt-3 text-lg text-ink-muted">Compare your Figma design with the live website.</p>
      </div>

      <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-border bg-white p-6 shadow-panel sm:p-8">
        {!loading ? (
          <form onSubmit={handleAnalyze} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Figma Design URL</label>
              <div className="relative">
                <Figma className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={17} />
                <input
                  type="text"
                  value={figmaUrl}
                  onChange={(e) => setFigmaUrl(e.target.value)}
                  placeholder="https://www.figma.com/design/…"
                  className="w-full rounded-xl border border-border bg-white py-3 pl-11 pr-4 text-sm text-ink shadow-sm outline-none transition placeholder:text-ink-muted/70 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Live Website URL</label>
              <div className="relative">
                <Globe2 className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={17} />
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourwebsite.com"
                  className="w-full rounded-xl border border-border bg-white py-3 pl-11 pr-4 text-sm text-ink shadow-sm outline-none transition placeholder:text-ink-muted/70 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Viewport</label>
              <ViewportSelect value={viewportIndex} onChange={setViewportIndex} />
            </div>

            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={checkResponsive}
                onChange={(e) => setCheckResponsive(e.target.checked)}
                className="h-4 w-4 rounded accent-violet-600"
              />
              Also run responsive checks at the other 5 viewport sizes (slower)
            </label>

            {status && !status.figmaConfigured && (
              <div className="flex items-start gap-2 rounded-xl border border-severity-medium/30 bg-severity-medium-bg px-3.5 py-3 text-sm text-severity-medium">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>
                  No Figma API token is configured yet, so live analysis is unavailable. Click <strong>Try Demo</strong> below to see
                  DesignCheck in action, or add <code className="rounded bg-white/60 px-1 py-0.5">FIGMA_TOKEN</code> to your{" "}
                  <code className="rounded bg-white/60 px-1 py-0.5">.env.local</code> file — see the README for exact steps.
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-severity-high/30 bg-severity-high-bg px-3.5 py-3 text-sm text-severity-high">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || Boolean(status && !status.figmaConfigured)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3.5 text-sm font-semibold text-white shadow-pop transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Analyze Design <ArrowRight size={16} />
            </button>

            <div className="relative py-1 text-center text-xs text-ink-muted">
              <span className="relative bg-white px-3">or</span>
              <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
            </div>

            <button
              type="button"
              onClick={handleDemo}
              disabled={demoLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 py-3.5 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles size={16} /> {demoLoading ? "Loading demo…" : "Try Demo"}
            </button>
            <p className="text-center text-xs text-ink-muted">
              No setup required — instantly see a realistic example with ~12 detected issues.
            </p>
          </form>
        ) : (
          <div className="py-4">
            <h2 className="mb-1 font-display text-lg font-semibold text-ink">Analyzing your design…</h2>
            <p className="mb-6 text-sm text-ink-muted">This usually takes 15–45 seconds.</p>
            <ProgressSteps steps={steps} />
          </div>
        )}
      </div>

      <div className="mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-3">
        {[
          { title: "1. Compare", text: "We match Figma elements to live DOM elements by text, type, position & size." },
          { title: "2. Detect", text: "Visual, content, layout & UX differences are measured — not guessed." },
          { title: "3. Report", text: "Review, approve, and export a developer-ready QA report in one click." },
        ].map((card) => (
          <div key={card.title} className="rounded-xl border border-border bg-white p-4 shadow-panel">
            <p className="text-sm font-semibold text-ink">{card.title}</p>
            <p className="mt-1 text-xs text-ink-muted">{card.text}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
