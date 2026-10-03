"use client";

import type { EChartsOption } from "echarts";
import { useCallback, useMemo, useState } from "react";
import { formatManwon } from "@/lib/format";
import type { TxPoint } from "@/lib/queries/items";
import { baseAxes, EChart, periodLabel, type ChartTokens } from "./echart";
import { defaultRange, rangeOptions, rangeSince, RangeChips, type RangeKey } from "./range-chips";

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
  const options = useMemo(() => {
    const first = points.reduce<string | null>((m, p) => (!m || p.deal_date < m ? p.deal_date : m), null);
    // 거래가 1년치뿐이어도 1년·전체는 고를 수 있게(최근 거래만 보고 싶을 때)
    const o = rangeOptions(first);
    return o.length ? o : (["1y", "all"] as RangeKey[]);
  }, [points]);
  const [range, setRange] = useState<RangeKey>(() => defaultRange(options, "3y"));
  const { filtered, sinceDay } = useMemo(() => {
    const s = rangeSince(range);
    return { filtered: points.filter((p) => !p.is_canceled && p.price && (!s || p.deal_date >= s)), sinceDay: s };
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
            if (!d.tx) return `${s}<br/>${periodLabel(d.value[0])} · <b>${formatManwon(d.value[1])}</b>`;
            const p = d.tx;
            return `${s} · ${periodLabel(p.deal_date, true)}<br/><b>${formatManwon(p.price)}</b>${p.area_m2 ? ` · ${p.area_m2}㎡` : ""}${p.floor ? ` · ${p.floor}층` : ""}${p.is_direct ? " · 직거래" : ""}`;
          },
        },
        xAxis: {
          type: "time",
          ...b.timeAxisStyle,
          ...(sparse ? { min: sinceDay ?? filtered.reduce((m, p) => (p.deal_date < m ? p.deal_date : m), filtered[0].deal_date), max: new Date().toISOString().slice(0, 10) } : {}),
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
            symbolSize: 9,
            itemStyle: { color: t.s1, opacity: 0.55, borderColor: t.surface, borderWidth: 1 },
            data: sale.map(dot),
          },
          {
            name: "전세",
            type: "scatter",
            symbolSize: 9,
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
    [filtered, sparse, sinceDay],
  );

  return (
    <div>
      <RangeChips options={options} value={range} onChange={setRange} />
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
