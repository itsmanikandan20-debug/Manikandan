import Image from "next/image";
import Link from "next/link";
import { Header } from "@/components/Header";
import { searchHistory } from "@/lib/mock-data";
import { getStageLabel } from "@/lib/mock-data";

const statusStyles: Record<string, string> = {
  completed: "bg-emerald-50 text-signal-verified",
  processing: "bg-blue-50 text-signal-match",
  no_matches: "bg-red-50 text-signal-notfound",
};

const statusLabel: Record<string, string> = {
  completed: "Completed",
  processing: "Processing",
  no_matches: "No matches",
};

export default function HistoryPage() {
  return (
    <>
      <Header title="Search history" description="Every design you've uploaded and analyzed" />

      <main className="mx-auto max-w-content px-6 py-8 lg:px-10">
        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-panel">
          <div className="hidden grid-cols-[80px_1.5fr_1fr_1fr_100px] gap-4 border-b border-border bg-surface-sunken px-5 py-3 text-xs font-medium text-ink-muted sm:grid">
            <span>Design</span>
            <span>File</span>
            <span>Top match</span>
            <span>Date</span>
            <span>Status</span>
          </div>

          <ul className="divide-y divide-border">
            {searchHistory.map((record) => {
              const topMatch = record.results[0];
              return (
                <li key={record.id}>
                  <Link
                    href={topMatch ? `/results` : "#"}
                    className="grid grid-cols-1 gap-3 px-5 py-4 transition-colors hover:bg-surface-sunken sm:grid-cols-[80px_1.5fr_1fr_1fr_100px] sm:items-center sm:gap-4"
                  >
                    <div className="h-14 w-14 overflow-hidden rounded-lg border border-border">
                      <Image
                        src={record.design.imageUrl}
                        alt={record.design.fileName}
                        width={120}
                        height={120}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {record.design.fileName}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {record.design.detectedLayout}
                      </p>
                    </div>
                    <div className="text-sm text-ink-soft">
                      {topMatch ? (
                        <>
                          <p className="truncate">{topMatch.websiteName}</p>
                          <p className="text-xs text-ink-muted">{getStageLabel(topMatch.stage)}</p>
                        </>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </div>
                    <p className="text-sm text-ink-muted">
                      {new Date(record.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                    <span
                      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[record.status]}`}
                    >
                      {statusLabel[record.status]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </>
  );
}
