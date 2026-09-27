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

export async function listSeries() {
  return sql<(SeriesMeta & { n: number; last: string | null })[]>`
    select s.code, s.name, s.unit, s.freq, s.source, s.category, s.region_cd,
      (select count(*)::int from series_values v where v.code = s.code) as n,
      (select max(period)::text from series_values v where v.code = s.code) as last
    from series s order by s.category, s.code`;
}

/** 관심 지역(시군구) 목록: 지표가 계산된 곳 */
export async function indicatorRegions(userId: string) {
  return sql<{ sgg: string; name: string; mine: boolean }[]>`
    select substr(s.code, length('ind.temp.') + 1) as sgg,
      coalesce(t.name, s.name) as name,
      exists (select 1 from watch_items w where w.user_id = ${userId} and w.sgg_cd = substr(s.code, length('ind.temp.') + 1)) as mine
    from series s left join collect_targets t on t.sgg_cd = substr(s.code, length('ind.temp.') + 1)
    where s.code like 'ind.temp.%'
    order by mine desc, name`;
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

export const MACRO_CODES = ["ecos.base_rate", "ecos.mortgage_rate", "ecos.bond_3y", "ecos.cpi", "ecos.m2"];
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
