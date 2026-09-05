import Image from "next/image";
import { Header } from "@/components/Header";
import { ResultCard } from "@/components/ResultCard";
import { currentMatches, currentUpload } from "@/lib/mock-data";

export default function ResultsPage() {
  const verifiedCount = currentMatches.filter((m) => m.stage === "live_verified").length;
  const notFoundCount = currentMatches.filter((m) => m.stage === "source_not_found").length;

  return (
    <>
      <Header
        title="Search results"
        description={`${currentMatches.length} candidate matches for ${currentUpload.fileName}`}
      />

      <main className="mx-auto max-w-content px-6 py-8 lg:px-10">
        <section className="flex flex-col gap-5 rounded-2xl border border-border bg-white p-5 shadow-panel sm:flex-row sm:items-center">
          <div className="h-28 w-full shrink-0 overflow-hidden rounded-xl border border-border sm:w-40">
            <Image
              src={currentUpload.imageUrl}
              alt={currentUpload.fileName}
              width={480}
              height={360}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-ink">{currentUpload.fileName}</p>
            <p className="mt-1 text-sm text-ink-muted">{currentUpload.detectedLayout}</p>
            <div className="mt-3 flex items-center gap-2">
              {currentUpload.dominantColors.map((color) => (
                <span
                  key={color}
                  title={color}
                  className="h-6 w-6 rounded-full border border-border"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-6 border-t border-border pt-4 sm:border-t-0 sm:border-l sm:pl-6 sm:pt-0">
            <div>
              <p className="text-xl font-semibold text-ink font-display">{verifiedCount}</p>
              <p className="text-xs text-ink-muted">Live verified</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-ink font-display">{notFoundCount}</p>
              <p className="text-xs text-ink-muted">Source not found</p>
            </div>
          </div>
        </section>

        <p className="mt-6 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-xs text-violet-800">
          Results are ranked by overall similarity, not certainty. A high score means
          the visual style is close — always check the badge to see whether the source
          has been identified and verified before assuming it&apos;s the original design.
        </p>

        <div className="mt-6 space-y-4">
          {currentMatches.map((result) => (
            <ResultCard key={result.id} result={result} />
          ))}
        </div>
      </main>
    </>
  );
}
