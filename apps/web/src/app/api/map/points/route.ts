import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { COMPLEX_TYPES, filtersFromQuery, type MapPoint } from "@/lib/map-filters";

export type { MapPoint };

const TYPES = new Set(["apt", "officetel", "rowhouse", "house", "land", "commercial"]);
const LIMIT = 400;

/**
 * 화면 영역(bbox) 안의 최근 거래를 단지(또는 읍면동) 단위로 집계하고 후보 탐색 필터를 적용한다.
 * 지표: 전세가율(최근 12개월 ㎡당 중위 비), 1년 변화(최근 6개월 vs 12~18개월 전 매매 ㎡당 중위, 각 2건 이상), 입지 점수(단지).
 */
export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const bbox = (sp.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) return NextResponse.json({ error: "bbox" }, { status: 400 });
  const [minx, miny, maxx, maxy] = bbox;
  const type = TYPES.has(sp.get("type") ?? "") ? sp.get("type")! : "apt";
  const months = Math.min(Math.max(Number(sp.get("months") ?? 6), 1), 60);
  const kind = sp.get("kind") === "jeonse" ? "jeonse" : "sale";
  const f = filtersFromQuery(sp);
  const envelope = sql`ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 4326)`;
  const since = sql`current_date - ${`${months} months`}::interval`;
  // 지표 계산에 18개월이 필요하다
  const win = sql`current_date - ${`${Math.max(months, 18)} months`}::interval`;
  const area = (col: ReturnType<typeof sql>) => sql`
    ${f.areaMin !== null ? sql`and ${col} >= ${f.areaMin}` : sql``}
    ${f.areaMax !== null ? sql`and ${col} <= ${f.areaMax}` : sql``}`;

  // 집계 열(t: deal_kind, deal_date, price, area)
  const aggCols = sql`
    count(*) filter (where deal_kind = ${kind} and deal_date >= ${since})::int as n,
    percentile_cont(0.5) within group (order by price) filter (where deal_kind = ${kind} and deal_date >= ${since})::float8 as median_price,
    percentile_cont(0.5) within group (order by price / nullif(area / 3.305785, 0)) filter (where deal_kind = ${kind} and deal_date >= ${since})::float8 as median_ppy,
    max(deal_date) filter (where deal_kind = ${kind} and deal_date >= ${since})::text as last_date,
    percentile_cont(0.5) within group (order by price / nullif(area, 0)) filter (where deal_kind = 'sale' and deal_date >= current_date - interval '12 months') as sale_12,
    percentile_cont(0.5) within group (order by price / nullif(area, 0)) filter (where deal_kind = 'jeonse' and deal_date >= current_date - interval '12 months') as jeonse_12,
    percentile_cont(0.5) within group (order by price / nullif(area, 0)) filter (where deal_kind = 'sale' and deal_date >= current_date - interval '6 months') as sale_recent,
    count(*) filter (where deal_kind = 'sale' and deal_date >= current_date - interval '6 months') as n_recent,
    percentile_cont(0.5) within group (order by price / nullif(area, 0)) filter (
      where deal_kind = 'sale' and deal_date >= current_date - interval '18 months' and deal_date < current_date - interval '12 months') as sale_prev,
    count(*) filter (where deal_kind = 'sale' and deal_date >= current_date - interval '18 months' and deal_date < current_date - interval '12 months') as n_prev`;
  const indicators = sql`
    (a.jeonse_12 / nullif(a.sale_12, 0))::float8 as jeonse_ratio,
    case when a.n_recent >= 2 and a.n_prev >= 2 then (a.sale_recent / nullif(a.sale_prev, 0) - 1)::float8 end as change_1y`;
  // 집계 뒤 필터(바깥 select 의 별칭 기준)
  const post = sql`
    where p.n > 0
    ${f.priceMin !== null ? sql`and p.median_price >= ${f.priceMin}` : sql``}
    ${f.priceMax !== null ? sql`and p.median_price <= ${f.priceMax}` : sql``}
    ${f.ppyMin !== null ? sql`and p.median_ppy >= ${f.ppyMin}` : sql``}
    ${f.ppyMax !== null ? sql`and p.median_ppy <= ${f.ppyMax}` : sql``}
    ${f.jrMin !== null ? sql`and p.jeonse_ratio >= ${f.jrMin}` : sql``}
    ${f.jrMax !== null ? sql`and p.jeonse_ratio <= ${f.jrMax}` : sql``}
    ${f.chgMin !== null ? sql`and p.change_1y >= ${f.chgMin}` : sql``}
    ${f.chgMax !== null ? sql`and p.change_1y <= ${f.chgMax}` : sql``}
    ${f.locMin !== null ? sql`and p.loc_score >= ${f.locMin}` : sql``}`;

  const query = COMPLEX_TYPES.has(type)
    ? sql<MapPoint[]>`
        with c as (
          select c.id, c.name, c.geom, c.build_year, c.households from complexes c
          where c.property_type = ${type} and c.geom && ${envelope}
            ${f.yearMin !== null ? sql`and c.build_year >= ${f.yearMin}` : sql``}
            ${f.yearMax !== null ? sql`and c.build_year <= ${f.yearMax}` : sql``}
            ${f.hhMin !== null ? sql`and c.households >= ${f.hhMin}` : sql``}
        ),
        t as (
          select t.complex_id, t.deal_kind, t.deal_date, t.price, t.area_m2 as area
          from transactions t join c on c.id = t.complex_id
          where t.property_type = ${type} and t.deal_kind in ('sale', 'jeonse') and not t.is_canceled and t.deal_date >= ${win}
            ${area(sql`t.area_m2`)}
        ),
        a as (select complex_id, ${aggCols} from t group by complex_id)
        select * from (
          select 'c' || c.id as key, 'complex' as kind, c.id as complex_id, c.name,
            ST_X(c.geom) as lng, ST_Y(c.geom) as lat, a.n, a.median_price, a.median_ppy, a.last_date,
            c.build_year::int as build_year, c.households, ${indicators}, ls.total::float8 as loc_score,
            (select count(*)::int from community_posts cp where cp.complex_id = c.id and cp.status = 'visible'
               and cp.created_at > now() - interval '7 days') as talk
          from a join c on c.id = a.complex_id
          left join location_scores ls on ls.target_type = 'complex' and ls.target_id = c.id::text
        ) p
        ${post}
        order by p.n desc
        limit ${LIMIT}`
    : sql<MapPoint[]>`
        with r as (select lawd_cd, emd, center from regions where center && ${envelope}),
        t as (
          select t.lawd_cd, t.umd_nm, t.deal_kind, t.deal_date, t.price, coalesce(t.area_m2, t.land_area_m2) as area
          from transactions t
          where t.property_type = ${type} and t.deal_kind in ('sale', 'jeonse') and not t.is_canceled and t.deal_date >= ${win}
            and t.lawd_cd in (select lawd_cd from r)
            ${area(sql`coalesce(t.area_m2, t.land_area_m2)`)}
        ),
        a as (select lawd_cd, min(umd_nm) as umd_nm, ${aggCols} from t group by lawd_cd)
        select * from (
          select 'r' || r.lawd_cd as key, 'region' as kind, null::bigint as complex_id, coalesce(r.emd, a.umd_nm) as name,
            ST_X(r.center) as lng, ST_Y(r.center) as lat, a.n, a.median_price, a.median_ppy, a.last_date,
            null::int as build_year, null::int as households, ${indicators}, null::float8 as loc_score, null::int as talk
          from a join r on r.lawd_cd = a.lawd_cd
        ) p
        ${post}
        order by p.n desc
        limit ${LIMIT}`;
  // 지도를 계속 옮기면 브라우저가 이전 요청을 끊는다 — DB 쿼리도 같이 취소해 커넥션을 비워 둔다
  const cancel = () => void query.cancel();
  req.signal.addEventListener("abort", cancel, { once: true });
  let points: MapPoint[];
  try {
    points = await query;
  } catch (e) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    throw e;
  } finally {
    req.signal.removeEventListener("abort", cancel);
  }
  return NextResponse.json({ points, truncated: points.length >= LIMIT });
}
