"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanEye, History, LayoutGrid, LogOut } from "lucide-react";
import { useFigmaAccount } from "@/lib/use-figma-account";

export function Navbar() {
  const pathname = usePathname();
  const { loading, figmaOAuthConfigured, connected, handle, avatarUrl, disconnect } = useFigmaAccount();

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

        {!loading && (
          <div className="hidden items-center gap-2 md:flex">
            {connected ? (
              <div className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-2 text-xs font-medium text-ink-soft">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="h-6 w-6 rounded-full" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-status-approved-bg text-status-approved">●</span>
                )}
                <span className="max-w-[110px] truncate">{handle ?? "Connected"}</span>
                <button onClick={disconnect} title="Disconnect Figma" className="rounded-full p-1 text-ink-muted hover:bg-surface-sunken hover:text-severity-high">
                  <LogOut size={13} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${figmaOAuthConfigured ? "bg-severity-medium" : "bg-ink-muted"}`} />
                {figmaOAuthConfigured ? "Figma not connected" : "Demo Mode only"}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
