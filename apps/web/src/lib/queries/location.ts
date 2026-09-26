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
