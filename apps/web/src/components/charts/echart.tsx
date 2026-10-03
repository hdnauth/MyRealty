"use client";

import type { EChartsOption } from "echarts";
import * as echarts from "echarts/core";
import { LineChart, ScatterChart, BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef, useState } from "react";
import { timeLabel } from "@/lib/chart-range";

export { periodLabel } from "@/lib/chart-range";

echarts.use([LineChart, ScatterChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer]);

export type ChartTokens = {
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  s5: string;
  grid: string;
  axis: string;
  ink: string;
  muted: string;
  surface: string;
  text: string;
};

function readTokens(): ChartTokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    s1: v("--series-1"),
    s2: v("--series-2"),
    s3: v("--series-3"),
    s4: v("--series-4"),
    s5: v("--series-5"),
    grid: v("--chart-grid"),
    axis: v("--chart-axis"),
    ink: v("--chart-ink"),
    muted: v("--chart-muted"),
    surface: v("--surface"),
    text: v("--text"),
  };
}

/** 토큰(라이트/다크)을 읽어 옵션을 만드는 ECharts 래퍼. 색 테마 변경 시 다시 그린다. */
export function EChart({
  build,
  height = 260,
  className,
  ariaLabel,
}: {
  build: (t: ChartTokens) => EChartsOption;
  height?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scheme, setScheme] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setScheme((x) => x + 1);
    mq.addEventListener("change", on);
    // 설정 › 화면 테마로 <html data-theme> 이 바뀌어도 다시 그린다
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", on);
      mo.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    const t = readTokens();
    chart.setOption({
      animationDuration: 300,
      textStyle: { fontFamily: getComputedStyle(document.body).fontFamily, color: t.ink },
      ...build(t),
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [build, scheme]);

  return <div ref={ref} role="img" aria-label={ariaLabel} className={className} style={{ height, width: "100%" }} />;
}

/** 공통 축/그리드/툴팁 스타일 */
export function baseAxes(t: ChartTokens) {
  return {
    grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.text, fontSize: 13 },
      extraCssText: "box-shadow:0 4px 16px rgba(0,0,0,.12);border-radius:10px;",
    },
    legend: { top: 0, left: 0, icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { color: t.ink, fontSize: 13 } },
    xAxisStyle: {
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true },
      splitLine: { show: false },
    },
    /** type: "time" 축 — 연·월이 늘 분명하게 */
    timeAxisStyle: {
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: t.muted,
        fontSize: 12,
        hideOverlap: true,
        formatter: timeLabel,
        rich: { y: { color: t.ink, fontSize: 12, fontWeight: "bold" as const } },
      },
      splitLine: { show: false },
    },
    yAxisStyle: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.muted, fontSize: 12 },
      splitLine: { lineStyle: { color: t.grid, width: 1 } },
    },
  };
}
