import Link from "next/link";
import { RelativeBars } from "@/components/items/relative-bars";
import { TxTable } from "@/components/items/tx-table";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { type AreaUnit, formatManwon, formatPct, fromPerPyeong, unitPriceName } from "@/lib/format";
import { nearbyMonths, PROPERTY_TYPES } from "@/lib/property";
import { landMarket } from "@/lib/queries/special";
import { LandMarketCard } from "./land-market-card";
import { groupChange, regionChange, relativePosition, similarComplexes } from "@/lib/queries/comps";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { myComplexItems, nearbyTransactions, similarCriteria, type WatchItem } from "@/lib/queries/items";
import { complexHref } from "@/lib/links";
import type { ViewMode } from "@/lib/view-mode";

/** 시세 탭 "비슷한 단지와 비교"(id=compare): 상대 성과 · 유사 단지 대비 가격 위치 · 유사 단지 표 · 토지 주변 시장 */
export async function NearbyCompare({ item, mode }: { item: WatchItem; mode: ViewMode }) {
  if (item.lng === null) return null;
  const isLand = item.property_type === "land" || item.property_type === "forest";
  const [sim, sgg, unit, land, mine] = await Promise.all([
    similarComplexes(item),
    item.sgg_cd ? regionChange(item.sgg_cd, PROPERTY_TYPES[item.property_type].tx, item.area_m2) : Promise.resolve(null),
    getAreaUnit(),
    isLand ? landMarket(item) : Promise.resolve(null),
    myComplexItems(item.user_id),
  ]);
  const compChange = groupChange(sim.comps);
  const pos = await relativePosition(item, sim.comps);
  const toUnit = (pts: [string, number][]) => pts.map(([d, v]) => [d, fromPerPyeong(v, unit)!] as [string, number]);
  if (!land && !sim.self && !sim.comps.length) {
    return item.complex_id ? (
      <Card id="compare" className="scroll-mt-20">
        <EmptyState title="비교할 비슷한 단지가 아직 없어요" desc="반경 안에서 같은 면적대 거래가 있는 단지가 모이면 가격 위치를 비교합니다." />
      </Card>
    ) : null;
  }

  return (
    <div id="compare" className="scroll-mt-20 space-y-4">
      {land ? <LandMarketCard m={land} item={item} /> : null}
      {pos?.rel ? (
        <Card>
          <CardHeader
            title="비슷한 단지 대비 가격 위치"
            sub={`${unitPriceName(unit)} · 3개월 이동 중위 · 유사 단지 ${sim.comps.length}곳 평균과 비교`}
            action={<Badge tone={pos.rel.z <= -1 ? "down" : pos.rel.z >= 1 ? "up" : "neutral"}>{pos.rel.verdict}</Badge>}
          />
          <div className="px-2">
            <LineSeriesChart
              lines={[
                { name: "내 단지", points: toUnit(pos.self.slice(-36)) },
                { name: "유사 단지", points: toUnit(pos.group.slice(-36)), dashed: true },
              ]}
              fmt="manwon"
              endLabels
            />
          </div>
          <p className="px-4 pb-4 text-xs leading-relaxed text-muted">
            지금 유사 단지보다 <b className="text-text">{formatPct(pos.rel.current)}</b> — 최근 3년 평균 격차는 {formatPct(pos.rel.average)}입니다
            {mode === "pro" ? ` (평소 대비 ${pos.rel.z >= 0 ? "+" : ""}${pos.rel.z.toFixed(1)} 표준편차)` : ""}.
            {pos.rel.z <= -1
              ? " 평소보다 격차가 벌어져 상대적으로 싸게 거래되고 있습니다. 단지 고유의 악재(재건축 지연, 하자 등)가 없는지 함께 확인하세요."
              : pos.rel.z >= 1
                ? " 평소보다 비싸게 거래되고 있습니다. 호재가 먼저 반영됐는지 확인하세요."
                : " 평소와 비슷한 격차입니다."}
          </p>
        </Card>
      ) : null}

      {sim.self ? (
        <Card>
          <CardHeader title="최근 1년 얼마나 올랐나" sub="단위면적당 가격 중위 · 최근 6개월 vs 1년 전(12~18개월) · 같은 면적대" />
          <div className="px-4 pb-4">
            <RelativeBars
              rows={[
                { label: "내 단지", value: sim.self.change, emphasis: true },
                { label: `유사 단지 ${sim.comps.length}곳`, value: compChange },
                { label: "시군구 전체", value: sgg },
              ]}
            />
            {sim.self.change !== null && compChange !== null ? (
              <p className="mt-3 text-xs text-muted">
                {Math.abs(sim.self.change - compChange) < 0.005
                  ? "유사 단지와 비슷한 흐름입니다."
                  : `유사 단지보다 ${formatPct(Math.abs(sim.self.change - compChange), 1, false)}p ${sim.self.change - compChange > 0 ? "더 올랐습니다" : "덜 올랐습니다"}.`}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {sim.comps.length ? (
        <Card>
          <CardHeader title="비슷한 단지" sub="거리·연식·세대수·단위면적당 가격이 비슷한 순 (유사도 0~100) · 단지명을 누르면 그 단지 시세" />
          <div className="overflow-x-auto pb-2">
            <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">단지</th>
                  <th className="px-2 py-2 text-right font-medium">유사도</th>
                  <th className="px-2 py-2 text-right font-medium">거리</th>
                  <th className="px-2 py-2 text-right font-medium">준공</th>
                  <th className="px-2 py-2 text-right font-medium">{unitPriceName(unit)}(6M)</th>
                  <th className="px-2 py-2 text-right font-medium">1년 변화</th>
                  <th className="px-4 py-2 text-right font-medium">최근 거래</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {sim.self ? <CompRow c={sim.self} unit={unit} self /> : null}
                {sim.comps.map((c) => (
                  <CompRow key={c.id} c={c} unit={unit} href={complexHref(c.id, mine, { area: item.area_m2 })} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** 시세 탭 "주변 거래"(id=nearby): 반경 내 비슷한(또는 전체) 매매 */
export async function NearbyTrades({ item, all = false }: { item: WatchItem; all?: boolean }) {
  if (item.lng === null) {
    return (
      <Card id="nearby">
        <EmptyState title="위치를 찾지 못해 주변 거래를 볼 수 없어요" desc="수정 화면에서 주소를 다시 골라 보세요. 위치가 잡히면 주변 거래·입지가 채워집니다." />
      </Card>
    );
  }
  const months = nearbyMonths(item.property_type);
  const [rows, mine] = await Promise.all([nearbyTransactions(item, { months, similar: !all }), myComplexItems(item.user_id)]);
  return (
    <Card id="nearby" className="scroll-mt-20">
      <CardHeader
        title={all ? "반경 내 최근 매매" : "반경 내 비슷한 매매"}
        sub={`반경 ${item.radius_m.toLocaleString()}m · 최근 ${months >= 12 ? `${months / 12}년` : `${months}개월`}${all ? "" : similarText(item)} · ${rows.length}건`}
        action={
          <span className="flex gap-3 text-sm">
            <Link href={`/items/${item.id}?tab=price${all ? "" : "&nall=1"}#nearby`} className="text-accent">
              {all ? "비슷한 것만" : "전체 보기"}
            </Link>
            <Link href={`/map?item=${item.id}`} className="text-accent">지도로 보기</Link>
          </span>
        }
      />
      <TxTable rows={rows} showName extra="dist" myComplexes={mine} mapType={PROPERTY_TYPES[item.property_type].tx} />
    </Card>
  );
}

function similarText(item: WatchItem) {
  const { areaRange, yearRange } = similarCriteria(item);
  const parts = [
    areaRange ? `면적 ${areaRange[0].toLocaleString()}~${areaRange[1].toLocaleString()}㎡` : null,
    yearRange ? `준공 ${yearRange[0]}~${yearRange[1]}년` : null,
    item.property_type === "land" ? "같은 지목" : item.property_type === "forest" ? "임야" : null,
  ].filter(Boolean);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function CompRow({ c, unit, self = false, href }: { unit: AreaUnit; c: { id: number; name: string; score: number; dist_m: number; build_year: number | null; ppy_recent: number | null; change: number | null; last_price: number | null }; self?: boolean; href?: string }) {
  return (
    <tr className={`border-b border-border/60 last:border-0 ${self ? "bg-accent-soft/50 font-medium" : "hover:bg-surface-2"}`}>
      <td className="max-w-[180px] truncate px-4 py-2">
        {self ? (
          `★ ${c.name}`
        ) : href ? (
          <Link href={href} className="text-accent hover:underline">
            {c.name}
          </Link>
        ) : (
          c.name
        )}
      </td>
      <td className="px-2 py-2 text-right">{self ? "-" : Math.round(c.score * 100)}</td>
      <td className="px-2 py-2 text-right">{self ? "-" : `${(c.dist_m / 1000).toFixed(1)}km`}</td>
      <td className="px-2 py-2 text-right">{c.build_year ?? "-"}</td>
      <td className="px-2 py-2 text-right">{formatManwon(fromPerPyeong(c.ppy_recent, unit), { short: true })}</td>
      <td className={`px-2 py-2 text-right ${c.change === null ? "text-muted" : c.change >= 0 ? "text-up" : "text-down"}`}>
        {c.change === null ? "-" : `${c.change >= 0 ? "▲" : "▼"}${formatPct(Math.abs(c.change), 1, false)}`}
      </td>
      <td className="px-4 py-2 text-right">{formatManwon(c.last_price, { short: true })}</td>
    </tr>
  );
}
