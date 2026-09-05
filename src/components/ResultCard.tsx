import Image from "next/image";
import Link from "next/link";
import { ExternalLink, GitCompareArrows } from "lucide-react";
import type { MatchResult } from "@/lib/types";
import { StageBadge } from "./StageBadge";
import { SimilarityRing } from "./SimilarityRing";

export function ResultCard({ result }: { result: MatchResult }) {
  const hasLiveLink = result.stage !== "source_not_found" && result.liveUrl;

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-white p-5 shadow-panel sm:flex-row">
      <div className="h-40 w-full shrink-0 overflow-hidden rounded-xl border border-border bg-surface-sunken sm:h-auto sm:w-56">
        <Image
          src={result.screenshotUrl}
          alt={`Screenshot of ${result.websiteName}`}
          width={640}
          height={440}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="flex flex-1 flex-col justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">{result.websiteName}</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                Checked {new Date(result.lastCheckedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
            <SimilarityRing score={result.similarityScore} />
          </div>

          <div className="mt-3">
            <StageBadge stage={result.stage} />
          </div>

          <div className="mt-3">
            <p className="text-xs font-medium text-ink-muted">What&apos;s similar</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {result.matchedOn.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-surface-sunken px-2 py-1 text-xs text-ink-soft"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {hasLiveLink ? (
            <a
              href={result.liveUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              <ExternalLink className="h-4 w-4" />
              View live website
            </a>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-lg bg-surface-sunken px-3.5 py-2 text-sm font-medium text-ink-muted">
              No confirmed link yet
            </span>
          )}
          <Link
            href={`/compare?match=${result.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-ink-soft hover:bg-surface-sunken"
          >
            <GitCompareArrows className="h-4 w-4" />
            Compare
          </Link>
        </div>
      </div>
    </div>
  );
}
