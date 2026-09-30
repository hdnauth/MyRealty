import "server-only";
import { sql } from "../db";

export type SeriesMeta = { code: string; name: string; unit: string | null; freq: string; source: string; category: string; region_cd: string | null };
export type Point = [string, number];

export async function seriesValues(codes: string[], since?: string): Promise<Record<string, Point[]>> {
  if (!codes.length) return {};
  const rows = await sql<{ code: string; period: string; value: number }[]>`
    select code, period::text, value from series_values
    where code = any(${codes}) ${since ? sql`and period >= ${since}` : sql``}
    order by code, period`;
  const out: Record<string, Point[]> = Object.fromEntries(codes.map((c) => [c, []]));
  for (const r of rows) out[r.code].push([r.period, r.value]);
  return out;
}

export async function seriesMeta(codes: string[]) {
  const rows = await sql<SeriesMeta[]>`select code, name, unit, freq, source, category, region_cd from series where code = any(${codes})`;
  return Object.fromEntries(rows.map((r) => [r.code, r])) as Record<string, SeriesMeta>;
}

/**
 * 지표 카탈로그: 공공 통계 전부 + 자체 계산 지역 지표(코드 끝 .시군구 5자리)는 내 관심 부동산이 있는 시군구만.
 * 자체 지역 지표는 누군가의 관심 부동산이 있는 시군구에만 생기므로 그대로 보이면 다른 사용자의 관심 지역이 드러난다.
 */
export async function listSeries(userId: string) {
  return sql<(SeriesMeta & { n: number; last: string | null })[]>`
    select s.code, s.name, s.unit, s.freq, s.source, s.category, s.region_cd,
      (select count(*)::int from series_values v where v.code = s.code) as n,
      (select max(period)::text from series_values v where v.code = s.code) as last
    from series s
    where s.source is distinct from 'myrealty' or s.code !~ '[.][0-9]{5}$'
       or substring(s.code from '[.]([0-9]{5})$') in (select w.sgg_cd from watch_items w where w.user_id = ${userId} and w.sgg_cd is not null)
    order by s.category, s.code`;
}

/**
 * 지표 화면의 지역(시군구) 목록: 내 관심 부동산이 있고 지표가 계산된 곳만.
 * 수집 대상(collect_targets)은 모든 사용자가 함께 쓰므로 그대로 보여 주면 다른 사람이 등록한 지역까지 보인다.
 */
export async function indicatorRegions(userId: string) {
  return sql<{ sgg: string; name: string }[]>`
    select g.sgg_cd as sgg, coalesce(t.name, s.name) as name
    from (select distinct w.sgg_cd from watch_items w where w.user_id = ${userId} and w.sgg_cd is not null) g
    join series s on s.code = 'ind.temp.' || g.sgg_cd
    left join collect_targets t on t.sgg_cd = g.sgg_cd
    order by name`;
}

export function last(points: Point[] | undefined): number | null {
  return points?.length ? points[points.length - 1][1] : null;
}

export function change(points: Point[] | undefined, months: number): number | null {
  if (!points || points.length <= months) return null;
  const a = points[points.length - 1 - months][1];
  const b = points[points.length - 1][1];
  return a ? b / a - 1 : null;
}

export const TEMP_FACTORS = [
  { key: "momentum", label: "가격 모멘텀" },
  { key: "turnover", label: "거래량 추세" },
  { key: "new_high", label: "신고가 비율" },
  { key: "decline", label: "하락 거래(역)" },
  { key: "burden", label: "월부담(역)" },
] as const;

export function tempBand(v: number | null) {
  if (v === null) return { label: "-", tone: "neutral" as const };
  if (v < 20) return { label: "냉각", tone: "down" as const };
  if (v < 40) return { label: "약세", tone: "down" as const };
  if (v < 60) return { label: "중립", tone: "neutral" as const };
  if (v < 80) return { label: "강세", tone: "up" as const };
  return { label: "과열", tone: "up" as const };
}

export const MACRO_CODES = [
  "ecos.base_rate", "ecos.mortgage_rate", "ecos.bond_3y", "ecos.cpi", "ecos.m2",
  // 수집되는 경우만 값이 있다(series-check 로 코드 확인 후 활성화)
  "ecos.housing_csi", "ecos.household_mortgage", "reb.supply_demand", "kosis.unsold_done", "kosis.permits",
];
/** 시장 해석(lib/insights)이 쓰는 지역 지표 키(접미사 `.{시군구}` 없이) */
export const INSIGHT_REGION_KEYS = ["idx", "vol", "jr", "nhr", "dr", "ind.burden", "ind.real", "ind.liq", "ind.supply", "jgap", "rrr", "corp", "unreg", "direct"];

/** 한 시군구의 시장 해석 입력(거시 + 지역 지표, 최근 8년) */
export async function insightInputs(sgg: string | null) {
  const since = new Date(new Date().getFullYear() - 8, 0, 1).toISOString().slice(0, 10);
  const v = await seriesValues([...MACRO_CODES, ...(sgg ? INSIGHT_REGION_KEYS.map((k) => `${k}.${sgg}`) : [])], since);
  return {
    ...Object.fromEntries(MACRO_CODES.map((c) => [c, v[c]])),
    ...(sgg ? Object.fromEntries(INSIGHT_REGION_KEYS.map((k) => [k, v[`${k}.${sgg}`]])) : {}),
  } as Record<string, Point[]>;
}
