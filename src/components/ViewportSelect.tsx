import { VIEWPORTS } from "@/lib/types";
import { Monitor } from "lucide-react";

export function ViewportSelect({ value, onChange }: { value: number; onChange: (index: number) => void }) {
  return (
    <div className="relative">
      <Monitor className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={17} />
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full appearance-none rounded-xl border border-border bg-white py-3 pl-11 pr-10 text-sm text-ink shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
      >
        {VIEWPORTS.map((vp, i) => (
          <option key={vp.label} value={i}>
            {vp.label}
          </option>
        ))}
      </select>
    </div>
  );
}
