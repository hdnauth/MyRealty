import "server-only";
import { sql } from "../db";
import type { WatchItem } from "./items";

export type ComplexStats = {
  id: number;
  name: string;
  umd_nm: string | null;
  build_year: number | null;
  households: number | null;
  dist_m: number;
  n_12m: number;
  ppy_recent: number | null; // 최근 6개월 평당가 중위(만원)
  ppy_prior: number | null; // 12~18개월 전 평당가 중위
  last_price: number | null;
  last_date: string | null;
};

export type Comp = ComplexStats & { score: number; change: number | null };

/**
 * 유사 단지: 같은 유형, 반경 내, 비슷한 면적대(±15%)의 거래가 있는 단지.
 * 점수 = 1 − 가중 거리(거리·연식·세대수·평당가 차이). 0~1, 높을수록 유사.
 */
export async function similarComplexes(item: WatchItem, opts: { radius?: number; limit?: number } = {}) {
  if (!item.complex_id || item.lng === null || item.lat === null) return { self: null, comps: [] as Comp[] };
  const radius = opts.radius ?? Math.max(item.radius_m, 2000);
  const area = item.area_m2 ?? 84;
  const rows = await sql<ComplexStats[]>`
    with cand as (
      select c.id, c.name, c.umd_nm, c.build_year, c.households,
        ST_Distance(c.geom::geography, ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)::geography)::int as dist_m
      from complexes c
      where c.property_type = (select property_type from complexes where id = ${item.complex_id})
        and c.geom is not null
        and (c.id = ${item.complex_id} or ST_DWithin(c.geom::geography, ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)::geography, ${radius}))
    )
    select cand.*,
      count(*) filter (where t.deal_date >= current_date - 365)::int as n_12m,
      percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785))
        filter (where t.deal_date >= current_date - 182)::float8 as ppy_recent,
      percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785))
        filter (where t.deal_date between current_date - 548 and current_date - 365)::float8 as ppy_prior,
      (array_agg(t.price order by t.deal_date desc))[1] as last_price,
      max(t.deal_date)::text as last_date
    from cand
    join transactions t on t.complex_id = cand.id and t.deal_kind = 'sale' and not t.is_canceled
      and t.area_m2 between ${area * 0.85} and ${area * 1.15} and t.deal_date >= current_date - 548
    group by cand.id, cand.name, cand.umd_nm, cand.build_year, cand.households, cand.dist_m`;

  const selfRow = rows.find((r) => r.id === item.complex_id) ?? null;
  const change = (r: ComplexStats) => (r.ppy_recent && r.ppy_prior ? r.ppy_recent / r.ppy_prior - 1 : null);
  const comps = rows
    .filter((r) => r.id !== item.complex_id && r.n_12m > 0)
    .map((r) => {
      const d = Math.min(r.dist_m / radius, 1);
      const by = selfRow?.build_year && r.build_year ? Math.min(Math.abs(selfRow.build_year - r.build_year) / 15, 1) : 0.5;
      const hh =
        selfRow?.households && r.households ? Math.min(Math.abs(Math.log(r.households / selfRow.households)) / Math.log(10), 1) : 0.5;
      const pp = selfRow?.ppy_recent && r.ppy_recent ? Math.min(Math.abs(r.ppy_recent / selfRow.ppy_recent - 1) / 0.5, 1) : 0.5;
      const score = 1 - (0.35 * d + 0.25 * by + 0.15 * hh + 0.25 * pp);
      return { ...r, score, change: change(r) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 8);
  return { self: selfRow ? { ...selfRow, score: 1, change: change(selfRow) } : null, comps };
}

export function groupChange(comps: Comp[]): number | null {
  const v = comps.map((c) => c.change).filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** 시군구 전체(동일 유형·면적대) 평당가 변화: 최근 6개월 vs 12~18개월 전 */
export async function regionChange(sggCd: string, txType: string, area: number | null) {
  const a = area ?? 84;
  const [r] = await sql<{ recent: number | null; prior: number | null }[]>`
    select
      percentile_cont(0.5) within group (order by price / (area_m2 / 3.305785)) filter (where deal_date >= current_date - 182)::float8 as recent,
      percentile_cont(0.5) within group (order by price / (area_m2 / 3.305785)) filter (where deal_date between current_date - 548 and current_date - 365)::float8 as prior
    from transactions
    where sgg_cd = ${sggCd} and property_type = ${txType} and deal_kind = 'sale' and not is_canceled
      and area_m2 between ${a * 0.85} and ${a * 1.15} and deal_date >= current_date - 548`;
  return r?.recent && r.prior ? r.recent / r.prior - 1 : null;
}
