import { ScanSearch, Link2, ShieldCheck } from "lucide-react";
import { Header } from "@/components/Header";
import { UploadDropzone } from "@/components/UploadDropzone";
import { StatCard } from "@/components/StatCard";
import { searchHistory } from "@/lib/mock-data";
import Image from "next/image";
import Link from "next/link";

export default function DashboardPage() {
  const recent = searchHistory.slice(0, 3);

  return (
    <>
      <Header
        title="Dashboard"
        description="Upload a design and find live websites that match it"
      />

      <main className="mx-auto max-w-content px-6 py-8 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-2xl border border-border bg-white p-6 shadow-panel">
            <h2 className="text-base font-semibold text-ink">Upload a screenshot</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Export a screenshot of your Figma frame and drop it below. We&apos;ll
              analyze the layout, hero section, colour palette, typography, card
              structure, and spacing to find comparable live websites.
            </p>
            <div className="mt-6">
              <UploadDropzone />
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <StatCard label="Searches this month" value="14" hint="Across 3 projects" icon={ScanSearch} />
            <StatCard label="Live sources verified" value="9" hint="Confirmed reachable just now" icon={ShieldCheck} />
            <StatCard label="Avg. top similarity" value="86%" hint="Best match per search" icon={Link2} />
          </section>
        </div>

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Recent searches</h2>
            <Link href="/history" className="text-sm font-medium text-violet-600 hover:text-violet-700">
              View all
            </Link>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((record) => (
              <Link
                key={record.id}
                href="/results"
                className="group overflow-hidden rounded-2xl border border-border bg-white shadow-panel transition-shadow hover:shadow-pop"
              >
                <div className="h-32 w-full overflow-hidden bg-surface-sunken">
                  <Image
                    src={record.design.imageUrl}
                    alt={record.design.fileName}
                    width={480}
                    height={280}
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                  />
                </div>
                <div className="p-4">
                  <p className="truncate text-sm font-medium text-ink">{record.design.fileName}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {new Date(record.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {record.results.length} match{record.results.length === 1 ? "" : "es"} found
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
