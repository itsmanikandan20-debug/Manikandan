"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  GitCompareArrows,
  History,
  ScanSearch,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/results", label: "Search results", icon: ScanSearch },
  { href: "/compare", label: "Compare designs", icon: GitCompareArrows },
  { href: "/history", label: "Search history", icon: History },
];

export function Sidebar() {
  const pathname = usePathname();
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((data) => setConfigured(Boolean(data.configured)))
      .catch(() => setConfigured(false));
  }, []);

  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-border bg-white lg:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white">
          <Sparkles className="h-4 w-4" strokeWidth={2.25} />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-ink">Design Similarity</p>
          <p className="text-xs text-ink-muted">Finder</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-5">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-violet-600 text-white shadow-pop"
                  : "text-ink-soft hover:bg-violet-50 hover:text-violet-700"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div
        className={`mx-3 mb-5 rounded-xl border p-4 ${
          configured ? "border-emerald-100 bg-emerald-50" : "border-violet-100 bg-violet-50"
        }`}
      >
        {configured === null ? (
          <p className="text-sm font-medium text-ink-muted">Checking setup…</p>
        ) : configured ? (
          <>
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              Real analysis is live
            </p>
            <p className="mt-1 text-xs leading-relaxed text-emerald-700/80">
              Uploads are analyzed with Gemini Vision and a real reverse-image search.
            </p>
          </>
        ) : (
          <>
            <p className="flex items-center gap-1.5 text-sm font-medium text-violet-800">
              <AlertCircle className="h-4 w-4" />
              API keys needed
            </p>
            <p className="mt-1 text-xs leading-relaxed text-violet-700/80">
              Add your keys to .env.local to enable real results. See README.md.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
