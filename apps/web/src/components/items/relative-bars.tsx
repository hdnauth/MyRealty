import { formatPct } from "@/lib/format";

/** 0을 기준으로 좌우로 뻗는 수익률 막대(상승=빨강 ▲, 하락=파랑 ▼, 값 라벨 병기) */
export function RelativeBars({ rows }: { rows: { label: string; value: number | null; emphasis?: boolean }[] }) {
  const max = Math.max(0.05, ...rows.map((r) => Math.abs(r.value ?? 0)));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const v = r.value;
        const w = v === null ? 0 : (Math.abs(v) / max) * 50;
        return (
          <div key={r.label} className="grid grid-cols-[88px_1fr_64px] items-center gap-2 text-sm">
            <span className={r.emphasis ? "font-semibold" : "text-muted"}>{r.label}</span>
            <div className="relative h-3 rounded-sm bg-surface-2">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              {v !== null ? (
                <div
                  className={`absolute inset-y-0 rounded-sm ${v >= 0 ? "bg-up" : "bg-down"} ${r.emphasis ? "" : "opacity-60"}`}
                  style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                />
              ) : null}
            </div>
            <span className={`tabular text-right ${v === null ? "text-muted" : v >= 0 ? "text-up" : "text-down"}`}>
              {v === null ? "-" : `${v >= 0 ? "▲" : "▼"}${formatPct(Math.abs(v), 1, false)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
