"use client";

import clsx from "clsx";
import { useState } from "react";
import { type AreaUnit, formatDate, formatManwon, M2_PER_PYEONG } from "@/lib/format";
import { DEAL_KIND_LABEL } from "@/lib/property";

export type Trade = { id: number; deal_kind: string; deal_date: string; price: number; monthly_rent: number | null; area_m2: number | null; floor: number | null; is_canceled: boolean };

/** 같은 평형으로 묶는 키: 전용 ㎡ 반올림(84.97·84.99 → 85) */
const areaKey = (m2: number | null) => (m2 ? Math.round(Number(m2)) : null);
const areaLabel = (m2: number, unit: AreaUnit) => (unit === "pyeong" ? `${(m2 / M2_PER_PYEONG).toFixed(0)}평` : `${m2}㎡`);

/**
 * 단지 거래 요약: 평형 칩(거래 많은 평형 순) → 매매·전세 시세 점 그래프 → 거래 목록.
 * 평형마다 값이 크게 달라 섞어 보면 시세를 읽기 어렵다 — 처음에는 내 면적(있으면)이나 거래가 가장 많은 평형을 고른다.
 */
export function ComplexTrades({ trades, unit, area = null, limit = 12 }: { trades: Trade[]; unit: AreaUnit; area?: number | null; limit?: number }) {
  const groups = [...trades.reduce((m, t) => {
    const k = areaKey(t.area_m2);
    if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, new Map<number, number>())].sort((a, b) => b[1] - a[1]);
  const mine = area !== null ? groups.find(([k]) => Math.abs(k - area) <= 3)?.[0] : undefined;
  const [pick, setPick] = useState<number | "all" | null>(null);
  const cur = pick ?? mine ?? (groups.length > 1 ? groups[0][0] : "all");
  const [more, setMore] = useState(false);
  const shown = trades.filter((t) => cur === "all" || areaKey(t.area_m2) === cur);
  if (!trades.length) return <p className="mt-3 text-sm text-muted">최근 거래가 없습니다.</p>;
  return (
    <div className="mt-3">
      {groups.length > 1 ? (
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2">
          {([["all", trades.length], ...groups.slice(0, 10)] as [number | "all", number][]).map(([k, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => setPick(k)}
              className={clsx("hit shrink-0 rounded-full border px-3.5 py-1.5 text-sm tabular", cur === k ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted")}
            >
              {k === "all" ? "전체" : areaLabel(k, unit)}
              <span className="ml-1 opacity-70">{n}</span>
            </button>
          ))}
        </div>
      ) : null}
      <TradeChart trades={shown} />
      <ul className="mt-1 divide-y divide-border text-sm">
        {(more ? shown : shown.slice(0, limit)).map((t) => (
          <li key={t.id} className={clsx("flex justify-between gap-2 py-2 tabular", t.is_canceled && "text-muted line-through")}>
            <span className="min-w-0 truncate text-muted">
              {formatDate(t.deal_date)} · <span className={t.deal_kind === "sale" ? "text-accent" : t.deal_kind === "jeonse" ? "text-ok" : "text-warn"}>{DEAL_KIND_LABEL[t.deal_kind] ?? t.deal_kind}</span>
              {cur === "all" && t.area_m2 ? ` · ${areaLabel(Math.round(Number(t.area_m2)), unit)}` : ""}
              {t.floor ? ` · ${t.floor}층` : ""}
            </span>
            <span className="shrink-0 font-medium">
              {formatManwon(t.price)}
              {t.monthly_rent ? `/${t.monthly_rent}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {!more && shown.length > limit ? (
        <button type="button" onClick={() => setMore(true)} className="mt-1 w-full rounded-md py-2.5 text-sm text-accent hover:bg-surface-2">
          거래 {shown.length - limit}건 더 보기
        </button>
      ) : null}
    </div>
  );
}

/** "25년 3월" — 점 그래프 양 끝 */
const ym = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월`;
};

/** 매매(파랑)·전세(초록) 실거래 점 그래프. 취소·월세는 뺀다. 해가 바뀌는 곳에 세로 눈금과 "2025년" */
function TradeChart({ trades }: { trades: Trade[] }) {
  const pts = trades.filter((t) => !t.is_canceled && (t.deal_kind === "sale" || (t.deal_kind === "jeonse" && !t.monthly_rent)));
  if (pts.length < 2) return null;
  const W = 320;
  const H = 120;
  const pad = { l: 40, r: 8, t: 8, b: 20 };
  const xs = pts.map((t) => Date.parse(t.deal_date));
  const ys = pts.map((t) => t.price);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const span = Math.max(y1 - y0, y1 * 0.1);
  y0 = Math.max(0, y0 - span * 0.1);
  y1 = y1 + span * 0.1;
  const x = (v: number) => pad.l + (x1 === x0 ? (W - pad.l - pad.r) / 2 : ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const mid = (y0 + y1) / 2;
  const years: number[] = [];
  for (let yr = new Date(x0).getFullYear() + 1; yr <= new Date(x1).getFullYear(); yr++) years.push(yr);
  // 양 끝 라벨과 겹치는 연 눈금 라벨은 숨긴다(선은 남김)
  const room = (W - pad.l - pad.r) * 0.16;
  const hasSale = pts.some((t) => t.deal_kind === "sale");
  const hasJeonse = pts.some((t) => t.deal_kind === "jeonse");
  return (
    <div>
      <div className="flex justify-end gap-3 text-xs text-muted">
        {hasSale ? <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-accent" />매매</span> : null}
        {hasJeonse ? <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-ok" />전세</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="최근 실거래가 점 그래프">
        {[y1, mid, y0].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={pad.l - 4} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--chart-muted)">
              {formatManwon(v, { short: true })}
            </text>
          </g>
        ))}
        {years.map((yr) => {
          const px = x(new Date(yr, 0, 1).getTime());
          const label = px - pad.l > room && W - pad.r - px > room;
          return (
            <g key={yr}>
              <line x1={px} x2={px} y1={pad.t} y2={H - pad.b} stroke="var(--chart-axis)" strokeWidth={1} strokeDasharray="2 3" />
              {label ? (
                <text x={px} y={H - 5} fontSize={11} textAnchor="middle" fontWeight={700} fill="var(--chart-ink)">
                  {yr}년
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={pad.l} y={H - 5} fontSize={11} fill="var(--chart-muted)">
          {ym(x0)}
        </text>
        <text x={W - pad.r} y={H - 5} fontSize={11} textAnchor="end" fill="var(--chart-muted)">
          {ym(x1)}
        </text>
        {pts.map((t) => (
          <circle key={t.id} cx={x(Date.parse(t.deal_date))} cy={y(t.price)} r={3.5} fill={t.deal_kind === "sale" ? "var(--accent)" : "var(--ok)"} fillOpacity={0.75} stroke="var(--surface)" strokeWidth={1}>
            <title>{`${formatDate(t.deal_date, "long")} ${DEAL_KIND_LABEL[t.deal_kind]} ${formatManwon(t.price)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
