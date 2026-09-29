import "server-only";
import { sql } from "../db";
import { type LocationScore, PEER_RADIUS_M } from "./location";
import { TX_COLUMNS, type TxPoint } from "./items";

export type ComplexInfo = {
  id: number;
  name: string;
  property_type: string;
  sgg_cd: string;
  lawd_cd: string | null;
  umd_nm: string | null;
  jibun: string | null;
  pnu: string | null;
  road_address: string | null;
  households: number | null;
  build_year: number | null;
  lng: number | null;
  lat: number | null;
  sido: string | null;
  sigungu: string | null;
};

/** 수집된 단지 하나(관심 부동산이 아니어도 볼 수 있는 단지 상세용) */
export async function getComplex(id: number): Promise<ComplexInfo | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [c] = await sql<ComplexInfo[]>`
    select c.id::int as id, c.name, c.property_type, c.sgg_cd, c.lawd_cd, c.umd_nm, c.jibun, c.pnu, c.road_address,
      coalesce(c.households, nullif(b.recap->>'households', '')::float8::int) as households, c.build_year,
      ST_X(c.geom) as lng, ST_Y(c.geom) as lat, r.sido, r.sigungu
    from complexes c
    left join building_registers b on b.pnu = c.pnu
    left join regions r on r.lawd_cd = substr(c.sgg_cd, 1, 5) || '00000'
    where c.id = ${id}`;
  return c ?? null;
}

export async function complexTransactions(id: number, years = 5): Promise<TxPoint[]> {
  return sql<TxPoint[]>`
    select ${TX_COLUMNS} from transactions t
    where t.complex_id = ${id} and t.deal_date >= current_date - ${`${years} years`}::interval
    order by t.deal_date`;
}

/** 단지 생활편의 점수 + 반경 1km 안 점수가 있는 단지들 중 백분위(itemLocation 과 같은 기준) */
export async function complexLocation(id: number) {
  const [row] = await sql<(LocationScore & { below: number | null; n: number | null })[]>`
    select l.total, l.scores, l.development, l.computed_at::text, p.below, p.n
    from location_scores l
    join complexes me on me.id::text = l.target_id
    left join lateral (
      select count(*) filter (where s.total < l.total)::int as below, count(*)::int as n
      from location_scores s join complexes c on c.id::text = s.target_id
      where s.target_type = 'complex' and s.total is not null and c.id <> me.id and c.geom is not null
        and ST_DWithin(c.geom::geography, me.geom::geography, ${PEER_RADIUS_M})
    ) p on l.total is not null and me.geom is not null
    where l.target_type = 'complex' and l.target_id = ${String(id)}`;
  if (!row) return null;
  const { below, n, ...score } = row;
  return { ...score, percentile: below !== null && n !== null && n >= 3 ? below / n : null, peers: n ?? 0 };
}
