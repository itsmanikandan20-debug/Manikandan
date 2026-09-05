import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Header } from "@/components/Header";
import { StageBadge } from "@/components/StageBadge";
import { currentMatches, currentUpload } from "@/lib/mock-data";

function scoreBarColor(score: number) {
  if (score >= 85) return "bg-signal-verified";
  if (score >= 65) return "bg-violet-600";
  if (score >= 45) return "bg-signal-unverified";
  return "bg-signal-notfound";
}

export default function ComparePage({
  searchParams,
}: {
  searchParams: { match?: string };
}) {
  const selected =
    currentMatches.find((m) => m.id === searchParams.match) ?? currentMatches[0];

  return (
    <>
      <Header
        title="Compare designs"
        description="See exactly which attributes match, side by side"
      />

      <main className="mx-auto max-w-content px-6 py-8 lg:px-10">
        <div className="flex flex-wrap gap-2">
          {currentMatches.map((match) => (
            <Link
              key={match.id}
              href={`/compare?match=${match.id}`}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                selected.id === match.id
                  ? "border-violet-600 bg-violet-600 text-white"
                  : "border-border bg-white text-ink-soft hover:bg-surface-sunken"
              }`}
            >
              {match.websiteName}
            </Link>
          ))}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-white p-5 shadow-panel">
            <p className="text-xs font-medium uppercase tracking-normal text-ink-muted">
              Your upload
            </p>
            <div className="mt-3 overflow-hidden rounded-xl border border-border">
              <Image
                src={currentUpload.imageUrl}
                alt={currentUpload.fileName}
                width={640}
                height={440}
                className="h-72 w-full object-cover"
              />
            </div>
            <p className="mt-3 text-sm font-medium text-ink">{currentUpload.fileName}</p>
            <p className="mt-1 text-xs text-ink-muted">{currentUpload.detectedLayout}</p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-5 shadow-panel">
            <p className="text-xs font-medium uppercase tracking-normal text-ink-muted">
              Candidate match
            </p>
            <div className="mt-3 overflow-hidden rounded-xl border border-border">
              <Image
                src={selected.screenshotUrl}
                alt={selected.websiteName}
                width={640}
                height={440}
                className="h-72 w-full object-cover"
              />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{selected.websiteName}</p>
                <div className="mt-1.5">
                  <StageBadge stage={selected.stage} />
                </div>
              </div>
              {selected.stage !== "source_not_found" && selected.liveUrl ? (
                <a
                  href={selected.liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  Visit
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-white p-5 shadow-panel">
          <h2 className="text-base font-semibold text-ink">Attribute breakdown</h2>
          <p className="mt-1 text-sm text-ink-muted">
            How closely each visual attribute matches your original design.
          </p>

          <div className="mt-5 space-y-4">
            {selected.matchedAttributes.length === 0 ? (
              <p className="text-sm text-ink-muted">
                A detailed breakdown hasn&apos;t been generated for this match yet.
              </p>
            ) : (
              selected.matchedAttributes.map((attr) => (
                <div key={attr.attribute}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink">{attr.attribute}</span>
                    <span className="text-ink-muted">{attr.score}%</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className={`h-full rounded-full ${scoreBarColor(attr.score)}`}
                      style={{ width: `${attr.score}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{attr.note}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </>
  );
}
