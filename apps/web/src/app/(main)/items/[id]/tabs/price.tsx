import { PriceHistoryChart } from "@/components/charts/price-history";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { TxTable } from "@/components/items/tx-table";
import { Card, CardHeader } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { formatArea } from "@/lib/format";
import { monthlyRollingMedian } from "@/lib/item-analytics";
import { complexSales, itemTransactions, type WatchItem } from "@/lib/queries/items";
import { clusterAreas } from "@/lib/units";
import type { ViewMode } from "@/lib/view-mode";
import { NearbyCompare, NearbyTrades } from "./nearby";

/**
 * 시세 탭: "얼마인가"와 "싼가 비싼가"의 근거를 한 흐름으로 —
 * 가격 추이 → 비슷한 단지와 비교 → 평형별 추이 → 거래 내역 → 주변 거래.
 * all: 거래 내역 전체, nall: 주변 거래 전체(비슷한 것만이 아니라)
 */
export async function PriceTab({ item, all = false, nall = false, mode }: { item: WatchItem; all?: boolean; nall?: boolean; mode: ViewMode }) {
  const [points, sales, unit] = await Promise.all([
    itemTransactions(item, 10),
    item.complex_id ? complexSales(item.complex_id, 5) : Promise.resolve([]),
    getAreaUnit(),
  ]);
  const scope = item.complex_id
    ? `${item.complex_name} · ${item.area_m2 ? `전용 ${formatArea(item.area_m2, unit).split(" ")[0]} ±3㎡` : "전체 평형"}`
    : `${item.umd_nm ?? "같은 지역"} · 유사 면적`;

  // 평형별 추이: 거래가 많은 평형 최대 5개, 면적 오름차순으로 색을 고정(평형이 곧 색)
  const types = clusterAreas(
    [...sales.reduce((m, s) => m.set(s.area_m2, (m.get(s.area_m2) ?? 0) + 1), new Map<number, number>())].map(([area, count]) => ({ area, count, trades: count })),
  )
    .sort((a, b) => b.trades - a.trades)
    .slice(0, 5)
    .sort((a, b) => a.area - b.area);
  // ★ 는 내 면적에 가장 가까운 평형 하나에만(±3㎡ 안에 비슷한 타입이 둘 이상 있어도)
  const mine = item.area_m2
    ? types.reduce<(typeof types)[number] | null>((b, t) => (Math.abs(item.area_m2! - t.area) <= 3 && (!b || Math.abs(item.area_m2! - t.area) < Math.abs(item.area_m2! - b.area)) ? t : b), null)
    : null;
  const lines = types.map((t) => ({
    name: `${formatArea(t.area, unit).split(" ")[0]}${t === mine ? " ★" : ""}`,
    points: monthlyRollingMedian(sales.filter((s) => Math.abs(s.area_m2 - t.area) <= 0.5).map((s) => ({ date: s.deal_date, value: s.price })), { minN: 1 }),
  }));
  const sections = [
    ["trend", "가격 추이"],
    ["compare", item.complex_id ? "비슷한 단지와 비교" : "주변 시장"],
    ["trades", "거래 내역"],
    ["nearby", "주변 거래"],
  ] as const;

  return (
    <div className="space-y-4">
      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label="시세 탭 바로가기">
        {sections.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-muted hover:border-accent hover:text-accent">
            {label}
          </a>
        ))}
      </nav>
      <Card id="trend" className="scroll-mt-20">
        <CardHeader title="실거래가 추이" sub={scope} />
        <div className="px-2 pb-3">
          <PriceHistoryChart points={points} />
        </div>
      </Card>
      <NearbyCompare item={item} mode={mode} />
      {lines.length >= 2 ? (
        <Card>
          <CardHeader title="평형별 가격 추이" sub="같은 단지 매매 · 3개월 이동 중위 · ★ 내 평형" />
          <div className="px-2 pb-3">
            <LineSeriesChart lines={lines} fmt="manwon" height={260} endLabels />
          </div>
        </Card>
      ) : null}
      <Card id="trades" className="scroll-mt-20">
        <CardHeader title="거래 내역" sub={`${points.length}건 · 해제(취소) 거래 포함 표시`} />
        <TxTable rows={[...points].reverse()} showName={!item.complex_id} discuss limit={all ? 5000 : 30} moreHref={`/items/${item.id}?tab=price&all=1#trades`} />
      </Card>
      <NearbyTrades item={item} all={nall} />
    </div>
  );
}
