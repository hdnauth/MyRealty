import "server-only";
import { sql } from "../db";

export type LocDetail =
  | { type: "near"; cats: string[]; subs: string[] | null; score: number; name: string | null; dist_m: number | null }
  | { type: "count"; cats: string[]; subs: string[] | null; score: number; count: number; radius: number }
  | { type: "area"; cats: string[]; score: number; area_m2: number; radius: number };

export type LocCategory = { label: string; score: number | null; weight?: number; status?: string; details?: LocDetail[] };

export type Development = {
  zones: { id: number; name: string; kind: string; stage: string | null; stage_order: number | null; stage_date: string | null; households_plan: number | null; dist_m: number }[];
  zones_count: number;
  zones_advanced: number;
  infra: { id: number; name: string; kind: string; line_name: string | null; status: string; status_order: number | null; expected_open: string | null; dist_m: number }[];
  nearest_planned_station: Development["infra"][number] | null;
  months_to_open?: number;
  rebuild?: { age: number; eligible: boolean; years_left: number };
  far?: { current: number; cap: number; headroom: number };
};

export type LocationScore = { total: number | null; scores: Record<string, LocCategory>; development: Development | null; computed_at: string };

export async function itemLocation(itemId: string, sggCd: string | null) {
  const [row] = await sql<LocationScore[]>`
    select total, scores, development, computed_at::text from location_scores where target_type = 'item' and target_id = ${itemId}`;
  if (!row) return null;
  let percentile: number | null = null;
  if (row.total !== null && sggCd) {
    const [p] = await sql<{ below: number; n: number }[]>`
      select count(*) filter (where s.total < ${row.total})::int as below, count(*)::int as n
      from location_scores s join complexes c on c.id::text = s.target_id
      where s.target_type = 'complex' and c.sgg_cd = ${sggCd} and s.total is not null`;
    if (p && p.n >= 3) percentile = p.below / p.n;
  }
  return { ...row, percentile };
}

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
  const out: OpeningEffect[] = [];
  const area = item.area_m2 ?? 84;
  for (const p of projects) {
    let complex: number | null = null;
    if (item.complex_id) {
      const [r] = await sql<{ before: number | null; after: number | null }[]>`
        select
          percentile_cont(0.5) within group (order by price / (area_m2 / 3.305785)) filter (where deal_date >= ${p.opened}::date - 365 and deal_date < ${p.opened}::date)::float8 as before,
          percentile_cont(0.5) within group (order by price / (area_m2 / 3.305785)) filter (where deal_date >= ${p.opened}::date and deal_date < ${p.opened}::date + 365)::float8 as after
        from transactions where complex_id = ${item.complex_id} and deal_kind = 'sale' and not is_canceled
          and area_m2 between ${area * 0.85} and ${area * 1.15}`;
      complex = r?.before && r.after ? r.after / r.before - 1 : null;
    }
    let region: number | null = null;
    if (item.sgg_cd) {
      const [r] = await sql<{ before: number | null; after: number | null }[]>`
        select avg(value) filter (where period >= ${p.opened}::date - 365 and period < ${p.opened}::date)::float8 as before,
               avg(value) filter (where period >= ${p.opened}::date and period < ${p.opened}::date + 365)::float8 as after
        from series_values where code = ${`idx.${item.sgg_cd}`}`;
      region = r?.before && r.after ? r.after / r.before - 1 : null;
    }
    out.push({ ...p, complex, region, excess: complex !== null && region !== null ? complex - region : null });
  }
  return out;
}
