function scoreColor(score: number): string {
  if (score >= 85) return "#1D9A6C";
  if (score >= 65) return "#C4790A";
  return "#E4342A";
}

export function CategoryBar({ label, score }: { label: string; score: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="font-semibold text-ink">{score}%</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, backgroundColor: scoreColor(score) }}
        />
      </div>
    </div>
  );
}
