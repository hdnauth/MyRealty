import clsx from "clsx";

/** 항목 순서·짧은 이름(지도 카드·단지 상세 공통) */
export const LOC_ORDER: [string, string][] = [
  ["transit", "교통"],
  ["jobs", "직주"],
  ["school", "학교"],
  ["shopping", "쇼핑"],
  ["park", "공원"],
  ["academy", "학원"],
  ["medical", "의료"],
  ["food", "음식"],
];

/** 0~100 점수 → 막대 색(낮음·보통·높음, 색만으로 구분하지 않게 숫자도 함께) */
const tone = (v: number) => (v >= 70 ? "bg-ok" : v >= 40 ? "bg-accent" : "bg-warn");

/**
 * 입지 항목별 점수 막대. 값이 없는(미수집) 항목은 회색 줄과 "-".
 * columns=2 면 두 줄로(지도 카드처럼 좁은 곳).
 */
export function LocBars({ cats, columns = 2, className }: { cats: Record<string, number | null | undefined>; columns?: 1 | 2; className?: string }) {
  const rows = LOC_ORDER.filter(([k]) => k in cats);
  return (
    <ul className={clsx("grid gap-x-4 gap-y-1.5 text-xs", columns === 2 ? "grid-cols-2" : "grid-cols-1", className)}>
      {rows.map(([k, label]) => {
        const v = cats[k];
        return (
          <li key={k} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-muted">{label}</span>
            <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              {v != null ? <span className={clsx("absolute inset-y-0 left-0 rounded-full", tone(v))} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} /> : null}
            </span>
            <span className="tabular w-6 shrink-0 text-right font-semibold">{v != null ? Math.round(v) : "-"}</span>
          </li>
        );
      })}
    </ul>
  );
}
