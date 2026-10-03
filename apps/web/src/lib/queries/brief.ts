import "server-only";
import { cache } from "react";
import { sql } from "../db";
import { type MarketBrief, type RegionSignals, regionSignals } from "../brief";
import { backtestInsights, insightBalance, marketInsights, rankInsights, signalRecord } from "../insights";
import { groupChange, relativePosition, similarComplexes } from "./comps";
import { insightInputs, last, seriesValues, tempBand } from "./indicators";
import type { ItemAttrs, WatchItem } from "./items";

/** "경기도 수원시 영통구" → "수원시 영통구", "서울특별시 송파구" → "송파구" */
export function shortRegion(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.split(" ").filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" ") : parts[0] ?? null;
}

/**
 * 시군구 시장 판정(요약 카드의 "시장 흐름")과 위험 신호용 지역 지표.
 * 지역 가격지수가 없으면(거래 30건 미만 등) 거시 지표만으로 "이 지역" 판정을 하지 않는다.
 */
export const marketBrief = cache(async (sgg: string | null): Promise<{ market: MarketBrief | null; unregistered: number | null; supply: number | null; signals: (RegionSignals & { name: string | null }) | null }> => {
  if (!sgg) return { market: null, unregistered: null, supply: null, signals: null };
  const [inputs, temps, [name]] = await Promise.all([
    insightInputs(sgg),
    seriesValues([`ind.temp.${sgg}`]),
    sql<{ name: string | null }[]>`
      select coalesce((select name from collect_targets where sgg_cd = ${sgg}),
        (select concat_ws(' ', sido, sigungu) from regions where lawd_cd = ${`${sgg}00000`})) as name`,
  ]);
  const unregistered = last(inputs.unreg);
  const supply = last(inputs["ind.supply"]);
  const region = shortRegion(name?.name);
  const signals = { ...regionSignals(inputs), name: region };
  if (!inputs.idx?.length) return { market: null, unregistered, supply, signals };
  const xs = marketInsights(inputs);
  const bt = backtestInsights(inputs);
  const b = insightBalance(xs);
  const temp = last(temps[`ind.temp.${sgg}`]);
  return {
    market: {
      region,
      verdict: b.verdict,
      up: b.up,
      down: b.down,
      reasons: rankInsights(xs, bt).filter((x) => x.tone !== "neutral").map((x) => x.title),
      temp,
      tempLabel: temp !== null ? tempBand(temp).label : null,
      record: signalRecord(xs, bt),
    },
    unregistered,
    supply,
    signals,
  };
});

/** 유사 단지 대비 위치(z)와 1년 변화 격차 — 단지형만 */
export async function compsBrief(item: Pick<WatchItem, "complex_id" | "lng" | "lat" | "radius_m" | "area_m2">) {
  if (!item.complex_id || item.lng === null) return { relative: null, compGap: null, comps: 0 };
  const sim = await similarComplexes(item as WatchItem);
  if (!sim.comps.length) return { relative: null, compGap: null, comps: 0 };
  const pos = await relativePosition(item as WatchItem, sim.comps);
  const g = groupChange(sim.comps);
  return {
    relative: pos?.rel ? { z: pos.rel.z, current: pos.rel.current, average: pos.rel.average } : null,
    compGap: sim.self?.change != null && g !== null ? sim.self.change - g : null,
    comps: sim.comps.length,
  };
}

/** 좌표(와 필지)가 토지거래허가구역 안인지 — 단지 화면용(관심 부동산은 itemRegulation) */
export async function pointPermit(lng: number | null, lat: number | null, pnu: string | null): Promise<boolean> {
  if (lng === null || lat === null) return false;
  const [r] = await sql<{ permit: boolean }[]>`
    select coalesce(exists (select 1 from regulation_areas r where r.kind = 'permit' and ST_Contains(r.geom, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))), false)
      or coalesce((select p.land_uses::text like '%토지거래%' from parcels p where p.pnu = ${pnu}), false) as permit`;
  return Boolean(r?.permit);
}

/** 공시가격(만원): 내 동·호 → 같은 필지의 최신 공동주택·개별주택 가격 */
export function officialPriceOf(attrs: ItemAttrs, dongHo: string | null): number | null {
  const rows = attrs.prices.filter((p) => p.target_type === "apt_unit" || p.target_type === "house");
  if (!rows.length) return null;
  const key = dongHo?.replace(/\s+/g, "");
  const mine = key ? rows.filter((p) => p.target_key.replace(/\s+/g, "").includes(key)) : [];
  const pick = (mine.length ? mine : rows).reduce((a, b) => (b.year > a.year ? b : a));
  return pick.price / 10000;
}
