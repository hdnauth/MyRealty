import clsx from "clsx";
import Link from "next/link";
import { ZONE_PHASES, ZONE_STAGES, zonePhase } from "@/lib/projects";

/** 9칸 진행 막대. labels 면 단계 이름을 아래에 */
export function StageBar({ order, labels = false, className }: { order: number | null; labels?: boolean; className?: string }) {
  const o = order ?? 0;
  const done = o === 9;
  return (
    <div className={clsx("flex gap-0.5", className)} role="img" aria-label={`${o}/9 단계`}>
      {ZONE_STAGES.map((s, i) => (
        <div key={s} className="min-w-0 flex-1">
          <div className={clsx("h-1.5 rounded-sm", i < o ? (done ? "bg-muted/60" : "bg-accent") : "bg-surface-2")} />
          {labels ? (
            <div className={clsx("mt-1 hidden truncate text-center text-[0.75rem] sm:block", i + 1 === o ? "font-semibold text-accent" : "text-muted")}>{s}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * 단계별 구역 수(가로 막대, 한 계열). 막대를 누르면 그 단계 묶음으로 거른다.
 * 완료(9)는 회색 — 진행 중 사업과 섞여 보이지 않게.
 */
export function StageDistribution({ counts, hrefFor, activePhase }: {
  counts: { stage_order: number | null; n: number }[];
  hrefFor: (phase: string) => string;
  activePhase: string | null;
}) {
  const by = new Map(counts.map((c) => [c.stage_order ?? 0, c.n]));
  const max = Math.max(1, ...counts.map((c) => c.n));
  const unknown = by.get(0) ?? 0;
  return (
    <div className="space-y-1 px-4 pb-3">
      {ZONE_STAGES.map((s, i) => {
        const n = by.get(i + 1) ?? 0;
        const phase = zonePhase(i + 1)!;
        const active = activePhase === phase;
        return (
          <Link
            key={s}
            href={hrefFor(phase)}
            scroll={false}
            title={`${s}: ${n.toLocaleString()}곳 — ${ZONE_PHASES.find((p) => p.key === phase)!.label} 단계만 보기`}
            className={clsx("group grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 rounded-md px-1 py-0.5 text-xs", active ? "bg-accent-soft" : "hover:bg-surface-2")}
          >
            <span className={clsx("truncate", active ? "font-semibold text-accent" : "text-muted")}>{s}</span>
            <span className="h-3 rounded-r bg-surface-2">
              <span
                className={clsx("block h-3 rounded-r", i === 8 ? "bg-muted/50" : "bg-accent", n === 0 && "hidden")}
                style={{ width: `${Math.max(1.5, (n / max) * 100)}%` }}
              />
            </span>
            <span className="tabular text-right">{n.toLocaleString()}</span>
          </Link>
        );
      })}
      {unknown ? <p className="px-1 pt-1 text-[0.75rem] text-muted">단계 미상 {unknown}곳</p> : null}
    </div>
  );
}

export function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={clsx(
        "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm",
        active ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted hover:text-text",
      )}
    >
      {children}
    </Link>
  );
}

export function formatDist(m: number | null | undefined) {
  if (m === null || m === undefined) return "";
  return m < 1000 ? `${m.toLocaleString()}m` : `${(m / 1000).toFixed(1)}km`;
}
