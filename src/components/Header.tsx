import { Search, Bell } from "lucide-react";

export function Header({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-white/90 px-6 backdrop-blur lg:px-10">
      <div>
        <h1 className="text-[15px] font-semibold text-ink">{title}</h1>
        {description ? (
          <p className="hidden text-xs text-ink-muted sm:block">{description}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-1.5 text-sm text-ink-muted md:flex">
          <Search className="h-4 w-4" />
          <span>Search past uploads…</span>
        </div>
        <button
          type="button"
          aria-label="Notifications"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-ink-soft hover:bg-surface-sunken"
        >
          <Bell className="h-4 w-4" />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
          RA
        </div>
      </div>
    </header>
  );
}
