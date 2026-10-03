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

let busiest: { at: number; center: [number, number] | null } | null = null;

/**
 * 관심 부동산이 없는 방문자의 첫 지도 중심: 최근 90일 아파트 매매가 가장 많은 시군구에서 거래 많은 단지 20곳의 중심
 * (지도 기본 필터가 아파트·매매라 첫 화면에 가격 라벨이 바로 보이는 곳). 서버 인스턴스마다 6시간 기억한다.
 */
export async function busiestCenter(): Promise<[number, number] | null> {
  if (busiest && Date.now() - busiest.at < 6 * 3600_000) return busiest.center;
  const [r] = await sql<{ lng: number | null; lat: number | null }[]>`
    with sgg as (
      select sgg_cd from transactions
      where property_type = 'apt' and deal_kind = 'sale' and deal_date > current_date - 90 and complex_id is not null
      group by 1 order by count(*) desc limit 1),
    top as (
      select t.complex_id from transactions t, sgg
      where t.sgg_cd = sgg.sgg_cd and t.property_type = 'apt' and t.deal_kind = 'sale'
        and t.deal_date > current_date - 90 and t.complex_id is not null
      group by 1 order by count(*) desc limit 20)
    select avg(ST_X(c.geom))::float8 as lng, avg(ST_Y(c.geom))::float8 as lat
    from top join complexes c on c.id = top.complex_id and c.geom is not null`;
  const center: [number, number] | null = r?.lng && r?.lat ? [r.lng, r.lat] : null;
  busiest = { at: Date.now(), center };
  return center;
}
