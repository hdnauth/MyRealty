"use client";

import type { EChartsOption } from "echarts";
import { useCallback, useMemo, useState } from "react";
import { baseAxes, EChart, periodLabel, type ChartTokens } from "@/components/charts/echart";
import { defaultRange, rangeOptions, rangeSince, RangeChips, type RangeKey } from "@/components/charts/range-chips";

type Pt = [string, number];

/**
 * 시장 요약 맨 위 그림: 위 = 가격지수(선), 아래 = 월 매매 건수(막대). 두 값은 단위가 달라 한 축에 겹치지 않고
 * x축(기간)을 함께 쓰는 두 칸으로 나눈다. 십자선·툴팁이 두 칸에 함께 걸린다. 집계 중인 이번 달 막대는 흐리게.
 */
export function MarketHero({ index, volume, height = 300 }: { index: Pt[]; volume: Pt[]; height?: number }) {
  const options = useMemo(() => {
    const first = [...index, ...volume].reduce<string | null>((m, [d]) => (!m || d < m ? d : m), null);
    return rangeOptions(first);
  }, [index, volume]);
  const [range, setRange] = useState<RangeKey>(() => defaultRange(options, "3y"));
  const thisMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  const { idx, vol } = useMemo(() => {
    const since = options.includes(range) ? rangeSince(range) : null;
    const cut = (p: Pt[]) => (since ? p.filter(([d]) => d >= since) : p);
    return { idx: cut(index), vol: cut(volume) };
  }, [index, volume, options, range]);

  const build = useCallback(
    (t: ChartTokens): EChartsOption => {
      const b = baseAxes(t);
      const min = [...idx, ...vol].reduce<string | undefined>((m, [d]) => (!m || d < m ? d : m), undefined);
      const max = [...idx, ...vol].reduce<string | undefined>((m, [d]) => (!m || d > m ? d : m), undefined);
      const x = { type: "time" as const, min, max };
      return {
        grid: [
          { left: 8, right: 44, top: 28, height: "52%", containLabel: true },
          { left: 8, right: 44, top: "72%", bottom: 4, containLabel: true },
        ],
        axisPointer: { link: [{ xAxisIndex: "all" }], lineStyle: { color: t.axis } },
        tooltip: {
          ...b.tooltip,
          trigger: "axis",
          formatter: (params: unknown) => {
            const ps = (Array.isArray(params) ? params : [params]) as { axisValue?: number | string; marker: string; seriesName: string; value: [string, number] }[];
            if (!ps.length) return "";
            const head = periodLabel(ps[0].axisValue ?? ps[0].value[0]);
            const rows = ps.map((p) => {
              const v = p.value[1];
              const txt = p.seriesName === "가격지수" ? v.toFixed(1) : `${Math.round(v).toLocaleString()}건${p.value[0] >= thisMonth ? " (집계 중)" : ""}`;
              return `${p.marker}${p.seriesName} <b style="float:right;margin-left:16px">${txt}</b>`;
            });
            return [`<div style="margin-bottom:2px;font-weight:600">${head}</div>`, ...rows].join("<br/>");
          },
        },
        xAxis: [
          { ...x, gridIndex: 0, ...b.timeAxisStyle, axisLabel: { show: false } },
          { ...x, gridIndex: 1, ...b.timeAxisStyle },
        ],
        yAxis: [
          {
            gridIndex: 0,
            type: "value",
            scale: true,
            name: "가격지수",
            nameTextStyle: { color: t.muted, fontSize: 12, align: "left", padding: [0, 0, 0, -4] },
            ...b.yAxisStyle,
            axisLabel: { ...b.yAxisStyle.axisLabel, formatter: (v: number) => v.toFixed(0) },
          },
          {
            gridIndex: 1,
            type: "value",
            name: "월 매매(건)",
            nameTextStyle: { color: t.muted, fontSize: 12, align: "left", padding: [0, 0, 0, -4] },
            splitNumber: 2,
            ...b.yAxisStyle,
            axisLabel: { ...b.yAxisStyle.axisLabel, formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}천` : String(v)) },
          },
        ],
        series: [
          {
            name: "가격지수",
            type: "line",
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: idx,
            showSymbol: false,
            lineStyle: { width: 2, color: t.s1 },
            itemStyle: { color: t.s1 },
            areaStyle: { color: t.s1, opacity: 0.08 },
            endLabel: { show: idx.length > 0, formatter: (p: { value?: unknown }) => (Array.isArray(p.value) ? Number(p.value[1]).toFixed(1) : ""), color: t.ink, fontSize: 12, fontWeight: "bold" },
          },
          {
            name: "월 매매",
            type: "bar",
            xAxisIndex: 1,
            yAxisIndex: 1,
            barMaxWidth: 10,
            data: vol.map(([d, v]) => ({
              value: [d, v],
              itemStyle: { color: t.muted, opacity: d >= thisMonth ? 0.35 : 0.85, borderRadius: [4, 4, 0, 0] },
            })),
          },
        ],
      };
    },
    [idx, vol, thisMonth],
  );

  if (!index.length && !volume.length) return null;
  return (
    <div>
      <RangeChips options={options} value={range} onChange={setRange} />
      <EChart build={build} height={height} ariaLabel="가격지수와 월 매매 건수 추이" />
    </div>
  );
}
