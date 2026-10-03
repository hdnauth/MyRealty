import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { applicableFilters, CATEGORY_GROUPS, COMPLEX_TYPES, type DealKind, filtersFromQuery, kindFor, type MapPoint, ZONE_GROUPS } from "@/lib/map-filters";

export type { MapPoint };

const TYPES = new Set(["apt", "officetel", "rowhouse", "house", "land", "commercial"]);
const LIMIT = 400;

/**
 * 화면 영역(bbox) 안의 최근 거래를 단지(또는 읍면동) 단위로 집계하고 후보 탐색 필터를 적용한다.
 * 지표: 전세가율(최근 12개월 ㎡당 중위 비), 1년 변화(최근 6개월 vs 12~18개월 전 매매 ㎡당 중위, 각 2건 이상), 입지 점수(단지),
 * 추정 임대수익률(단지: 최근 12개월 월세×12 ÷ (매매 − 월세 보증금), ㎡당 중위), 대지 평당가(단독), 지분·법인·직거래 비율.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bbox = (sp.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) return NextResponse.json({ error: "bbox" }, { status: 400 });
  const [minx, miny, maxx, maxy] = bbox;
  const type = TYPES.has(sp.get("type") ?? "") ? sp.get("type")! : "apt";
  const months = Math.min(Math.max(Number(sp.get("months") ?? 6), 1), 60);
  const rawKind = sp.get("kind");
  const kind = kindFor(type, rawKind === "jeonse" || rawKind === "wolse" ? (rawKind as DealKind) : "sale");
  // 유형·거래 종류에 맞지 않는 조건은 무시한다(다른 유형에서 걸어 둔 조건이 남아 있어도 결과가 비지 않게)
  const f = applicableFilters(filtersFromQuery(sp), type, kind);
  const complexType = COMPLEX_TYPES.has(type);
  const envelope = sql`ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 4326)`;
  const since = sql`current_date - ${`${months} months`}::interval`;
  // 지표 계산에 18개월이 필요하다
  const win = sql`current_date - ${`${Math.max(months, 18)} months`}::interval`;
  const area = (col: ReturnType<typeof sql>) => sql`
    ${f.areaMin !== null ? sql`and ${col} >= ${f.areaMin}` : sql``}
    ${f.areaMax !== null ? sql`and ${col} <= ${f.areaMax}` : sql``}`;

  // 단지가 없는 유형: 거래 단위 조건(세부 유형·용도지역·지분·건물 유형·층·준공)
  const catValues = f.cats.flatMap((k) => (CATEGORY_GROUPS[type as "house" | "land" | "commercial"] ?? []).find((g) => g.key === k)?.values ?? []);
  const catCol = type === "land" ? sql`t.jimok` : type === "house" ? sql`t.house_type` : sql`t.raw->>'buildingUse'`;
  const zoneRe = ZONE_GROUPS.filter((z) => f.zones.includes(z.key))
    .map((z) => z.match)
    .join("|");
  const txFilters = sql`
    ${catValues.length ? sql`and ${catCol} in ${sql(catValues)}` : sql``}
    ${zoneRe ? sql`and t.land_use ~ ${zoneRe}` : sql``}
    ${f.noShare ? sql`and coalesce(t.raw->>'shareDealingType', '') <> '지분'` : sql``}
    ${f.bldg ? sql`and t.house_type = ${f.bldg}` : sql``}
    ${f.floor === "ground" ? sql`and t.floor = 1` : f.floor === "upper" ? sql`and t.floor > 1` : sql``}
    ${!complexType && f.yearMin !== null ? sql`and t.build_year >= ${f.yearMin}` : sql``}
    ${!complexType && f.yearMax !== null ? sql`and t.build_year <= ${f.yearMax}` : sql``}`;

  // 집계 열(t: deal_kind, deal_date, price, rent, area, land_area, share, corp, direct)
  const cur = sql`deal_kind = ${kind} and deal_date >= ${since}`;
  const sale12 = sql`deal_kind = 'sale' and deal_date >= current_date - interval '12 months'`;
  const wolse12 = sql`deal_kind = 'wolse' and deal_date >= current_date - interval '12 months'`;
  const aggCols = sql`
    count(*) filter (where ${cur})::int as n,
    percentile_cont(0.5) within group (order by price) filter (where ${cur})::float8 as median_price,
    percentile_cont(0.5) within group (order by price / nullif(area / 3.305785, 0)) filter (where ${cur})::float8 as median_ppy,
    percentile_cont(0.5) within group (order by rent) filter (where ${cur} and rent > 0)::float8 as median_rent,
    percentile_cont(0.5) within group (order by price / nullif(land_area / 3.305785, 0)) filter (where ${cur} and deal_kind = 'sale')::float8 as land_ppy,
    max(deal_date) filter (where ${cur})::text as last_date,
    (count(*) filter (where ${cur} and share))::float8 / nullif(count(*) filter (where ${cur}), 0) as share_ratio,
    (count(*) filter (where ${cur} and corp))::float8 / nullif(count(*) filter (where ${cur} and corp is not null), 0) as corp_ratio,
    (count(*) filter (where ${cur} and direct))::float8 / nullif(count(*) filter (where ${cur}), 0) as direct_ratio,
    percentile_cont(0.5) within group (order by price / nullif(area, 0)) filter (where ${sale12}) as sale_12,
    count(*) filter (where ${sale12}) as n_sale_12,
    percentile_cont(0.5) within group (order by price / nullif(area, 0)) filter (where deal_kind = 'jeonse' and deal_date >= current_date - interval '12 months') as jeonse_12,
    percentile_cont(0.5) within group (order by price / nullif(area, 0)) filter (where ${wolse12}) as wdep_12,
    percentile_cont(0.5) within group (order by rent / nullif(area, 0)) filter (where ${wolse12} and rent > 0) as rent_12,
    count(*) filter (where ${wolse12} and rent > 0) as n_wolse_12,
    percentile_cont(0.5) within group (order by price / nullif(area, 0)) filter (where deal_kind = 'sale' and deal_date >= current_date - interval '6 months') as sale_recent,
    count(*) filter (where deal_kind = 'sale' and deal_date >= current_date - interval '6 months') as n_recent,
    percentile_cont(0.5) within group (order by price / nullif(area, 0)) filter (
      where deal_kind = 'sale' and deal_date >= current_date - interval '18 months' and deal_date < current_date - interval '12 months') as sale_prev,
    count(*) filter (where deal_kind = 'sale' and deal_date >= current_date - interval '18 months' and deal_date < current_date - interval '12 months') as n_prev`;
  // 1년 변동 최소 표본: 단지는 같은 건물이라 2건이면 되지만, 읍면동(토지·단독·상가)은 필지·건물이 제각각이라 몇 건으로는 −80%·+180% 같은 잡음이 난다
  const minChg = complexType ? 2 : 6;
  // 전세가율·수익률은 단지형만: 단독·다가구는 매매가 건물 전체, 임대는 방 단위 계약이라 ㎡당으로 나눠도 비교가 되지 않는다
  const indicators = sql`
    ${complexType ? sql`(a.jeonse_12 / nullif(a.sale_12, 0))::float8` : sql`null::float8`} as jeonse_ratio,
    case when a.n_recent >= ${minChg} and a.n_prev >= ${minChg} then (a.sale_recent / nullif(a.sale_prev, 0) - 1)::float8 end as change_1y,
    case when ${complexType} and a.n_sale_12 >= 2 and a.n_wolse_12 >= 3 and a.sale_12 > coalesce(a.wdep_12, 0)
      then least(a.rent_12 * 12 / (a.sale_12 - coalesce(a.wdep_12, 0)), 0.3)::float8 end as rent_yield,
    a.median_rent, a.land_ppy, a.share_ratio, a.corp_ratio, a.direct_ratio`;
  // 집계 뒤 필터(바깥 select 의 별칭 기준)
  const post = sql`
    where p.n > 0
    ${f.priceMin !== null ? sql`and p.median_price >= ${f.priceMin}` : sql``}
    ${f.priceMax !== null ? sql`and p.median_price <= ${f.priceMax}` : sql``}
    ${f.ppyMin !== null ? sql`and coalesce(p.land_ppy, p.median_ppy) >= ${f.ppyMin}` : sql``}
    ${f.ppyMax !== null ? sql`and coalesce(p.land_ppy, p.median_ppy) <= ${f.ppyMax}` : sql``}
    ${f.jrMin !== null ? sql`and p.jeonse_ratio >= ${f.jrMin}` : sql``}
    ${f.jrMax !== null ? sql`and p.jeonse_ratio <= ${f.jrMax}` : sql``}
    ${f.chgMin !== null ? sql`and p.change_1y >= ${f.chgMin}` : sql``}
    ${f.chgMax !== null ? sql`and p.change_1y <= ${f.chgMax}` : sql``}
    ${f.locMin !== null ? sql`and p.loc_score >= ${f.locMin}` : sql``}
    ${f.yieldMin !== null ? sql`and p.rent_yield >= ${f.yieldMin}` : sql``}
    ${f.rentMax !== null ? sql`and p.median_rent <= ${f.rentMax}` : sql``}`;

  // 거래 행 공통 열
  // 지분 여부는 원천 JSON(raw)에만 있다 — 큰 JSON 을 행마다 읽으면 아파트 3년 조회가 수십 배 느려져 토지·상가만 본다
  const shareCol = type === "land" || type === "commercial" ? sql`t.raw->>'shareDealingType' = '지분'` : sql`false`;
  const txCols = sql`t.deal_kind, t.deal_date, t.price, t.monthly_rent as rent,
    ${shareCol} as share,
    case when t.buyer_type is null then null else t.buyer_type like '%법인%' end as corp,
    coalesce(t.is_direct, false) as direct`;

  // 월세 행: 수익률은 최근 12개월만 쓰므로 월세 보기가 아니면 그만큼만 읽는다(월세가 매매의 몇 배라 3년치를 다 읽으면 느리다)
  const kinds = sql`and (t.deal_kind in ('sale', 'jeonse') or (t.deal_kind = 'wolse' and t.deal_date >= ${kind === "wolse" ? since : sql`current_date - interval '12 months'`}))`;
  const query = complexType
    ? sql<MapPoint[]>`
        with c as (
          select c.id, c.name, c.geom, c.build_year, c.households from complexes c
          where c.property_type = ${type} and c.geom && ${envelope}
            ${f.yearMin !== null ? sql`and c.build_year >= ${f.yearMin}` : sql``}
            ${f.yearMax !== null ? sql`and c.build_year <= ${f.yearMax}` : sql``}
            ${f.hhMin !== null ? sql`and c.households >= ${f.hhMin}` : sql``}
        ),
        t as (
          select t.complex_id, ${txCols}, t.area_m2 as area, null::numeric as land_area
          from transactions t join c on c.id = t.complex_id
          where t.property_type = ${type} and not t.is_canceled and t.deal_date >= ${win} ${kinds}
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
          select t.lawd_cd, t.umd_nm, ${txCols}, coalesce(t.area_m2, t.land_area_m2) as area,
            case when ${type} = 'house' then t.land_area_m2 end as land_area
          from transactions t
          where t.property_type = ${type} and not t.is_canceled and t.deal_date >= ${win} ${kinds}
            and t.lawd_cd in (select lawd_cd from r)
            ${area(sql`coalesce(t.area_m2, t.land_area_m2)`)}
            ${txFilters}
        ),
        a as (select lawd_cd, min(umd_nm) as umd_nm, ${aggCols} from t group by lawd_cd)
        select * from (
          select 'r' || r.lawd_cd as key, 'region' as kind, null::bigint as complex_id, coalesce(r.emd, a.umd_nm) as name,
            ST_X(r.center) as lng, ST_Y(r.center) as lat, a.n, a.median_price, a.median_ppy, a.last_date,
            null::int as build_year, null::int as households, ${indicators}, null::float8 as loc_score, null::int as talk,
            r.lawd_cd::text as lawd_cd
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
  return NextResponse.json({ points, truncated: points.length >= LIMIT, kind });
}
