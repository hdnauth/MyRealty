"use client";

import { RelativeBars } from "@/components/items/relative-bars";

/** 온도계 요인 기여(z-score) — 함수 prop 은 클라이언트에서만 넘길 수 있어 래핑한다 */
export function ContribBars({ rows }: { rows: { label: string; value: number | null }[] }) {
  return <RelativeBars rows={rows} minScale={1} format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`} />;
}
