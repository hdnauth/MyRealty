"use client";

import type { EChartsOption } from "echarts";
import { useCallback, useMemo, useState } from "react";
import { formatManwon } from "@/lib/format";
import { baseAxes, EChart, periodLabel, type ChartTokens } from "./echart";
import { defaultRange, rangeOptions, rangeSince, RangeChips, type RangeKey } from "./range-chips";

export type Fmt = "pct" | "pct100" | "num" | "num1" | "manwon" | "ratio";
export type LineSpec = { name: string; points: [string, number][]; slot?: 1 | 2 | 3 | 4 | 5; dashed?: boolean };

export function fmtValue(v: number, fmt: Fmt): string {
  switch (fmt) {
    case "pct":
      return `${v.toFixed(2)}%`;
    case "pct100":
      return `${(v * 100).toFixed(1)}%`;
    case "num":
      return Math.round(v).toLocaleString("ko-KR");
    case "num1":
      return v.toFixed(1);
    case "manwon":
      return formatManwon(v, { short: true });
    case "ratio":
      return `${(v * 100).toFixed(0)}%`;
  }
}

/** 같은 단위의 시계열만 한 축에 그린다(이중축 금지). 2개 이상이면 범례 표시. */
export function LineSeriesChart({
  lines,
  fmt = "num1",
  height = 220,
  bands,
  yMin,
  yMax,
  kind = "line",
  endLabels = false,
  range: wantedRange = "3y",
}: {
  /** 처음 보여 줄 기간(자료가 더 짧으면 전체). false 면 기간 버튼 없이 전체 */
  range?: RangeKey | false;
  /** 선 끝에 이름 표시(4개 이하일 때만 — 색만으로 구분하지 않도록) */
  endLabels?: boolean;
  lines: LineSpec[];
  fmt?: Fmt;
  height?: number;
  bands?: number[]; // 기준선(예: 온도계 20/40/60/80)
  yMin?: number;
  yMax?: number;
  kind?: "line" | "bar";
}) {
  const options = useMemo(() => {
    if (wantedRange === false) return [];
    const first = lines.flatMap((l) => l.points.map((p) => p[0])).reduce<string | null>((m, d) => (!m || d < m ? d : m), null);
    return rangeOptions(first);
  }, [lines, wantedRange]);
  const [range, setRange] = useState<RangeKey>(() => (wantedRange === false ? "all" : defaultRange(options, wantedRange)));
  const shown = useMemo(() => {
    const since = options.includes(range) ? rangeSince(range) : null;
    return since ? lines.map((l) => ({ ...l, points: l.points.filter((p) => p[0] >= since) })) : lines;
  }, [lines, options, range]);

  const build = useCallback(
    (t: ChartTokens): EChartsOption => {
      const lines = shown;
      const b = baseAxes(t);
      const colors = { 1: t.s1, 2: t.s2, 3: t.s3, 4: t.s4, 5: t.s5 };
      // 끝 값이 서로 너무 가까우면(세로 범위의 7% 이내) 이름이 겹치므로 끝 라벨을 끄고 범례로만 구분한다
      const ends = lines.map((l) => l.points.at(-1)?.[1]).filter((x): x is number => x !== undefined).sort((a, b) => a - b);
      const all = lines.flatMap((l) => l.points.map((p) => p[1]));
      const span = all.length ? Math.max(...all) - Math.min(...all) : 0;
      const crowded = ends.some((v, i) => i > 0 && span > 0 && (v - ends[i - 1]) / span < 0.07);
      const labelEnds = endLabels && lines.length <= 4 && !crowded;
      return {
        grid: { ...b.grid, top: lines.length > 1 ? 36 : 16, right: labelEnds ? 84 : b.grid.right },
        legend: lines.length > 1 ? { ...b.legend, data: lines.map((l) => l.name) } : undefined,
        tooltip: {
          ...b.tooltip,
          trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: t.axis } },
          formatter: (params: unknown) => {
            const ps = (Array.isArray(params) ? params : [params]) as { axisValue?: string | number; marker: string; seriesName: string; value: [string, number] | number }[];
            if (!ps.length) return "";
            const head = periodLabel(ps[0].axisValue ?? (Array.isArray(ps[0].value) ? ps[0].value[0] : ""));
            const rows = ps.map((p) => {
              const v = Array.isArray(p.value) ? p.value[1] : p.value;
              return `${p.marker}${p.seriesName} <b style="float:right;margin-left:16px">${typeof v === "number" ? fmtValue(v, fmt) : "-"}</b>`;
            });
            return [`<div style="margin-bottom:2px;font-weight:600">${head}</div>`, ...rows].join("<br/>");
          },
        },
        xAxis: { type: "time", ...b.timeAxisStyle },
        yAxis: {
          type: "value",
          scale: yMin === undefined,
          min: yMin,
          max: yMax,
          ...b.yAxisStyle,
          axisLabel: { ...b.yAxisStyle.axisLabel, formatter: (v: number) => fmtValue(v, fmt) },
        },
        series: lines.map((l, i) => {
          const color = colors[l.slot ?? (Math.min(i, 4) + 1) as 1 | 2 | 3 | 4 | 5];
          return kind === "bar"
            ? { name: l.name, type: "bar", data: l.points, itemStyle: { color, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 10 }
            : {
                name: l.name,
                type: "line",
                data: l.points,
                showSymbol: false,
                lineStyle: { width: 2, color, type: l.dashed ? "dotted" : "solid" },
                itemStyle: { color },
                endLabel: labelEnds ? { show: true, formatter: l.name.length > 6 ? `${l.name.slice(0, 6)}…` : l.name, color: t.ink, fontSize: 12 } : undefined,
                markLine:
                  i === 0 && bands?.length
                    ? { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: t.grid, type: "solid", width: 1 }, data: bands.map((y) => ({ yAxis: y })) }
                    : undefined,
              };
        }),
      };
    },
    [shown, fmt, bands, yMin, yMax, kind, endLabels],
  );
  if (!lines.some((l) => l.points.length)) {
    return <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>데이터 없음</div>;
  }
  return (
    <div>
      <RangeChips options={options} value={range} onChange={setRange} />
      <EChart build={build} height={height} ariaLabel={lines.map((l) => l.name).join(", ")} />
    </div>
  );
}

/** 작은 추세선(축·툴팁 없음) — 스탯 타일 옆 */
export function Sparkline({ points, height = 36 }: { points: [string, number][]; height?: number }) {
  const build = useCallback(
    (t: ChartTokens): EChartsOption => ({
      grid: { left: 0, right: 0, top: 4, bottom: 4 },
      xAxis: { type: "time", show: false },
      yAxis: { type: "value", show: false, scale: true },
      series: [{ type: "line", data: points, showSymbol: false, lineStyle: { width: 1.5, color: t.s1 }, silent: true }],
      tooltip: { show: false },
    }),
    [points],
  );
  if (points.length < 2) return null;
  return <EChart build={build} height={height} />;
}
