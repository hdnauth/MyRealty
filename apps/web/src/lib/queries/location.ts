import "server-only";
import { sql } from "../db";

export type LocDetail =
  | { type: "near"; cats: string[]; subs: string[] | null; label?: string; score: number; name: string | null; dist_m: number | null; area_m2?: number }
  | { type: "count"; cats: string[]; subs: string[] | null; label?: string; score: number; count: number; eff?: number; k?: number; radius: number }
  | { type: "area"; cats: string[]; score: number; area_m2: number; radius: number }
  | { type: "lines"; cats: string[]; score: number; walk: number; name: string | null; lines?: string[]; n_lines?: number; dist_m?: number; guess?: boolean }
  | { type: "jobs"; score: number; name: string; dist_m: number; second?: { name: string; dist_m: number }; core?: { name: string; dist_m: number; score: number } };

export type LocCategory = { label: string; score: number | null; weight?: number; status?: string; details?: LocDetail[] };

export type Development = {
  zones: { id: number; name: string; kind: string; stage: string | null; stage_order: number | null; stage_date: string | null; households_plan: number | null; dist_m: number }[];
  zones_count: number;
  zones_advanced: number;
  infra: { id: number; name: string; kind: string; line_name: string | null; status: string; status_order: number | null; expected_open: string | null; dist_m: number }[];
  nearest_planned_station: Development["infra"][number] | null;
  months_to_open?: number;
  rebuild?: { age: number; eligible: boolean; years_left: number };
  far?: { current: number; cap: number; headroom: number; basis?: "seoul" | "law" };
};

export type LocationScore = { total: number | null; scores: Record<string, LocCategory>; development: Development | null; computed_at: string };

/**
 * 입지 점수 + 백분위. 백분위는 반경 1km 안에서 시설이 갖춰진 상태로(basis = full) 계산한 단지들과 비교한다 —
 * 지도에서 즉석으로 낸 간이 점수(밀집 시설 빠짐)와 섞으면 순위가 틀어진다.
 */
export async function itemLocation(itemId: string) {
  // 점수·백분위·내 관심 부동산 중 순위를 한 쿼리로(왕복 1회)
  const [row] = await sql<(LocationScore & { below: number | null; n: number | null; my_rank: number | null; my_n: number | null })[]>`
    select l.total, l.scores, l.development, l.computed_at::text, p.below, p.n, m.my_rank, m.my_n
    from location_scores l
    join watch_items w on w.id::text = l.target_id
    left join lateral (
      select count(*) filter (where s.total < l.total)::int as below, count(*)::int as n
      from location_scores s join complexes c on c.id::text = s.target_id
      where s.target_type = 'complex' and s.total is not null and s.basis = 'full' and c.geom is not null and w.geom is not null
        and ST_DWithin(c.geom::geography, w.geom::geography, ${PEER_RADIUS_M})
        and (w.complex_id is null or c.id <> w.complex_id)
    ) p on l.total is not null
    left join lateral (
      select 1 + count(*) filter (where s.total > l.total)::int as my_rank, count(*)::int as my_n
      from location_scores s join watch_items o on o.id::text = s.target_id
      where s.target_type = 'item' and s.total is not null and o.user_id = w.user_id
    ) m on l.total is not null
    where l.target_type = 'item' and l.target_id = ${itemId}`;
  if (!row) return null;
  const { below, n, my_rank, my_n, ...score } = row;
  const percentile = below !== null && n !== null && n >= 3 ? below / n : null;
  return { ...score, percentile, peers: n ?? 0, myRank: my_n && my_n >= 2 ? my_rank : null, myCount: my_n ?? 0 };
}

export type CalibrationEffect = { label: string; per10_pct: number; weight_now: number; weight_fit: number; weight_suggest: number };
export type Spread = { n: number; p10: number; p50: number; p90: number; std: number } | null;
export type LocationCalibration = {
  computed_at: string;
  status: "ok" | "insufficient";
  complexes_with_price: number;
  min_complexes: number;
  n?: number;
  sggs?: number;
  r2_age_only?: number;
  r2_total?: number;
  r2_categories?: number;
  total_per10_pct?: number;
  effects?: Record<string, CalibrationEffect>;
  spread: Record<string, Spread>;
};

/** 가장 최근 입지 점수 검증(ETL analytics/location_calibration.py) — 점수가 평당가 차이를 얼마나 설명하는지 */
export async function locationCalibration(): Promise<LocationCalibration | null> {
  const [row] = await sql<{ computed_at: string; result: Omit<LocationCalibration, "computed_at"> }[]>`
    select computed_at::text, result from location_calibrations order by computed_at desc, id desc limit 1`.catch(() => []);
  return row ? { computed_at: row.computed_at, ...row.result } : null;
}

/** 백분위 비교 반경(m) */
export const PEER_RADIUS_M = 1000;

export type OpeningEffect = { name: string; opened: string; dist_m: number; complex: number | null; region: number | null; excess: number | null };

/**
 * 개통 전후 1년 가격 변화(이벤트 스터디): 반경 3km 에서 최근 6년 내 개통한 사업에 대해
 * 내 단지 평당가 중위(개통 후 12개월 / 개통 전 12개월)와 시군구 자체 지수 변화를 비교한다.
 */
export async function openingEffects(item: { complex_id: number | null; sgg_cd: string | null; lng: number | null; lat: number | null; area_m2: number | null }) {
  if (item.lng === null || item.lat === null) return [];
  const projects = await sql<{ name: string; opened: string; dist_m: number }[]>`
    select name, expected_open::text as opened,
      ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)::geography)::int as dist_m
    from infra_projects
    where status = '개통' and expected_open between current_date - interval '6 years' and current_date - interval '3 months'
      and geom is not null and ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)::geography, 3000)
    order by dist_m limit 5`;
  const area = item.area_m2 ?? 84;
  // 사업마다 단지·지역 변화를 동시에 조회(순서대로 돌면 사업 수 × 2 번 왕복)
  return Promise.all(
    projects.map(async (p): Promise<OpeningEffect> => {
      const [c, g] = await Promise.all([
        item.complex_id
          ? sql<{ before: number | null; after: number | null }[]>`
              select
                percentile_cont(0.5) within group (order by price / (area_m2 / 3.305785)) filter (where deal_date >= ${p.opened}::date - 365 and deal_date < ${p.opened}::date)::float8 as before,
                percentile_cont(0.5) within group (order by price / (area_m2 / 3.305785)) filter (where deal_date >= ${p.opened}::date and deal_date < ${p.opened}::date + 365)::float8 as after
              from transactions where complex_id = ${item.complex_id} and deal_kind = 'sale' and not is_canceled
                and area_m2 between ${area * 0.85} and ${area * 1.15}`
          : null,
        item.sgg_cd
          ? sql<{ before: number | null; after: number | null }[]>`
              select avg(value) filter (where period >= ${p.opened}::date - 365 and period < ${p.opened}::date)::float8 as before,
                     avg(value) filter (where period >= ${p.opened}::date and period < ${p.opened}::date + 365)::float8 as after
              from series_values where code = ${`idx.${item.sgg_cd}`}`
          : null,
      ]);
      const change = (r: { before: number | null; after: number | null } | undefined) => (r?.before && r.after ? r.after / r.before - 1 : null);
      const complex = change(c?.[0]);
      const region = change(g?.[0]);
      return { ...p, complex, region, excess: complex !== null && region !== null ? complex - region : null };
    }),
  );
}
