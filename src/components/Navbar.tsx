"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ScanEye, History, LayoutGrid } from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<{ figmaConfigured: boolean; geminiConfigured: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutGrid },
    { href: "/history", label: "History", icon: History },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-white/90 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-content items-center justify-between px-6 py-3.5 lg:px-10">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white">
            <ScanEye size={18} />
          </span>
          <span className="font-display text-lg font-bold text-ink">DesignCheck</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((link) => {
            const active = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-violet-50 text-violet-700" : "text-ink-soft hover:bg-surface-sunken"
                }`}
              >
                <Icon size={15} />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {status && (
          <div className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-muted md:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${status.figmaConfigured ? "bg-status-approved" : "bg-severity-medium"}`} />
            {status.figmaConfigured ? "Live analysis ready" : "Demo Mode only"}
          </div>
        )}
      </div>
    </header>
  );
}
