"use client";

import type { EChartsOption } from "echarts";
import { useCallback, useMemo, useState } from "react";
import { formatManwon } from "@/lib/format";
import type { TxPoint } from "@/lib/queries/items";
import { baseAxes, EChart, type ChartTokens } from "./echart";

const RANGES = [
  { key: "1y", label: "1년", months: 12 },
  { key: "3y", label: "3년", months: 36 },
  { key: "5y", label: "5년", months: 60 },
  { key: "all", label: "전체", months: 1200 },
] as const;

function monthKey(d: string) {
  return d.slice(0, 7);
}

function monthlyMedian(points: TxPoint[]) {
  const by = new Map<string, number[]>();
  for (const p of points) {
    const k = monthKey(p.deal_date);
    by.set(k, [...(by.get(k) ?? []), p.price]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => {
      const s = [...v].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return [`${k}-15`, s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2] as [string, number];
    });
}

/** 실거래 산점도(매매·전세) + 매매 월 중위선. y축 하나(만원→억 표시). */
export function PriceHistoryChart({ points, height = 280 }: { points: TxPoint[]; height?: number }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("3y");
  const { filtered, sinceDay } = useMemo(() => {
    const months = RANGES.find((r) => r.key === range)!.months;
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const s = since.toISOString().slice(0, 10);
    return { filtered: points.filter((p) => !p.is_canceled && p.price && p.deal_date >= s), sinceDay: s };
  }, [points, range]);
  // 거래가 드물면(1~2건) 시간축이 며칠 단위로 좁아져 '15 16 17…'처럼 보인다 — 고른 기간 전체를 축으로 쓴다
  const sparse = filtered.length > 0 && filtered.length < 6;

  const build = useCallback(
    (t: ChartTokens): EChartsOption => {
      const b = baseAxes(t);
      const sale = filtered.filter((p) => p.deal_kind === "sale");
      const jeonse = filtered.filter((p) => p.deal_kind === "jeonse");
      const dot = (p: TxPoint) => ({ value: [p.deal_date, p.price], tx: p });
      return {
        grid: b.grid,
        legend: { ...b.legend, data: ["매매", "전세", "매매 월 중위"] },
        tooltip: {
          ...b.tooltip,
          trigger: "item",
          formatter: (param: unknown) => {
            const d = (param as { data: { tx?: TxPoint; value: [string, number] }; seriesName: string }).data;
            const s = (param as { seriesName: string }).seriesName;
            if (!d.tx) return `${s}<br/>${d.value[0].slice(0, 7)} · <b>${formatManwon(d.value[1])}</b>`;
            const p = d.tx;
            return `${s} · ${p.deal_date}<br/><b>${formatManwon(p.price)}</b>${p.area_m2 ? ` · ${p.area_m2}㎡` : ""}${p.floor ? ` · ${p.floor}층` : ""}${p.is_direct ? " · 직거래" : ""}`;
          },
        },
        xAxis: {
          type: "time",
          ...b.xAxisStyle,
          ...(sparse ? { min: range === "all" ? filtered[0].deal_date : sinceDay, max: new Date().toISOString().slice(0, 10) } : {}),
        },
        yAxis: {
          type: "value",
          scale: true,
          ...b.yAxisStyle,
          axisLabel: { ...b.yAxisStyle.axisLabel, formatter: (v: number) => formatManwon(v, { short: true }) },
        },
        series: [
          {
            name: "매매",
            type: "scatter",
            symbolSize: 8,
            itemStyle: { color: t.s1, opacity: 0.55, borderColor: t.surface, borderWidth: 1 },
            data: sale.map(dot),
          },
          {
            name: "전세",
            type: "scatter",
            symbolSize: 8,
            itemStyle: { color: t.s2, opacity: 0.55, borderColor: t.surface, borderWidth: 1 },
            data: jeonse.map(dot),
          },
          {
            name: "매매 월 중위",
            type: "line",
            showSymbol: false,
            smooth: 0.2,
            lineStyle: { width: 2, color: t.s1 },
            itemStyle: { color: t.s1 },
            data: monthlyMedian(sale).map((v) => ({ value: v })),
            z: 3,
          },
        ],
      };
    },
    [filtered, sparse, sinceDay, range],
  );

  return (
    <div>
      <div className="mb-2 flex justify-end gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`rounded-md px-2 py-1 text-xs ${range === r.key ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2"}`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {filtered.length ? (
        <EChart build={build} height={height} ariaLabel="실거래가 추이 차트" />
      ) : (
        <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>
          해당 기간 거래가 없습니다.
        </div>
      )}
    </div>
  );
}
