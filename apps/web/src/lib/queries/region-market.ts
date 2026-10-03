import "server-only";
import { sql } from "../db";
import { REGION_TYPES, type RegionGroup, type RegionMarket, type RegionSignals, type RegionTrade, type RegionType } from "../region-market";

export { isRegionType, REGION_TYPE_INFO, REGION_TYPES, type RegionMarket, type RegionType, regionInsights } from "../region-market";

const CATEGORY = {
  house: sql`t.house_type`,
  land: sql`t.jimok`,
  // 상업업무용: 건물 용도(제1종근린생활·숙박 등)가 원천에만 있다. 없으면 집합/일반
  commercial: sql`coalesce(nullif(t.raw->>'buildingUse', ''), t.house_type)`,
} satisfies Record<RegionType, unknown>;

export async function regionMarket(lawd: string, type: RegionType, opts: { years?: number; limit?: number } = {}): Promise<RegionMarket | null> {
  if (!/^\d{10}$/.test(lawd)) return null;
  const years = opts.years ?? 3;
  const limit = opts.limit ?? 300;
  const sgg = lawd.slice(0, 5);
  const [region] = await sql<RegionMarket["region"][]>`
    select r.lawd_cd, ${sgg}::text as sgg_cd, coalesce(r.emd, '') as emd,
      coalesce(ct.name, nullif(concat_ws(' ', r2.sido, r2.sigungu), '')) as sgg_name,
      ST_X(r.center) as lng, ST_Y(r.center) as lat
    from regions r
    left join collect_targets ct on ct.sgg_cd = ${sgg}
    left join regions r2 on r2.lawd_cd = rpad(${sgg}, 10, '0')
    where r.lawd_cd = ${lawd}`;
  if (!region) return null;
  const cat = CATEGORY[type];
  const base = sql`t.lawd_cd = ${lawd} and t.property_type = ${type} and t.deal_date >= current_date - ${`${years} years`}::interval`;
  const sale = sql`${base} and t.deal_kind = 'sale' and not t.is_canceled`;
  const unit = sql`t.price / nullif(coalesce(t.area_m2, t.land_area_m2), 0)`;
  const y1 = sql`t.deal_date >= current_date - 365`;
  const share = sql`t.raw->>'shareDealingType' = '지분'`;
  const med = (expr: typeof unit, where: typeof unit) => sql`(percentile_cont(0.5) within group (order by ${expr}) filter (where ${where}))::float8`;
  const [trades, groups, zones, typeRows, [stats], [signals]] = await Promise.all([
    sql<RegionTrade[]>`
      select t.id::int as id, t.deal_kind, t.deal_date::text as deal_date, t.price::float8 as price, t.monthly_rent,
        coalesce(t.area_m2, t.land_area_m2)::float8 as area_m2,
        case when t.area_m2 is not null then t.land_area_m2::float8 end as land_area_m2,
        t.floor, t.build_year, t.jibun, ${cat} as category, t.land_use, t.is_canceled, t.is_direct
      from transactions t where ${base}
      order by t.deal_date desc, t.id desc limit ${limit}`,
    sql<RegionGroup[]>`
      select coalesce(${cat}, '미상') as category, count(*)::int as n,
        count(*) filter (where t.deal_date >= current_date - 365)::int as n12m,
        percentile_cont(0.5) within group (order by ${unit})::float8 as "perM2",
        percentile_cont(0.5) within group (order by t.price)::float8 as price,
        percentile_cont(0.5) within group (order by coalesce(t.area_m2, t.land_area_m2))::float8 as area
      from transactions t where ${sale}
      group by 1 order by n desc limit 10`,
    type === "house"
      ? []
      : sql<RegionMarket["zones"]>`
          select t.land_use as zone, count(*)::int as n, percentile_cont(0.5) within group (order by ${unit})::float8 as "perM2"
          from transactions t where ${sale} and t.land_use is not null
          group by 1 order by n desc limit 8`,
    sql<{ type: RegionType; n: number }[]>`
      select t.property_type as type, count(*)::int as n from transactions t
      where t.lawd_cd = ${lawd} and t.property_type in ('house', 'land', 'commercial') and t.deal_date >= current_date - 365 and not t.is_canceled
      group by 1`,
    sql<RegionMarket["stats"][]>`
      select
        count(*) filter (where t.deal_kind = 'sale' and t.deal_date >= current_date - 365)::int as "sale12m",
        count(*) filter (where t.deal_kind = 'jeonse' and t.deal_date >= current_date - 365)::int as "jeonse12m",
        count(*) filter (where t.deal_kind = 'wolse' and t.deal_date >= current_date - 365)::int as "wolse12m",
        (percentile_cont(0.5) within group (order by t.price) filter (where t.deal_kind = 'sale' and t.deal_date >= current_date - 365))::float8 as "salePrice12m",
        (percentile_cont(0.5) within group (order by ${unit}) filter (where t.deal_kind = 'sale' and t.deal_date >= current_date - 365))::float8 as "perM2_12m",
        case when count(*) filter (where t.deal_kind = 'sale' and t.deal_date >= current_date - interval '6 months') >= 6
              and count(*) filter (where t.deal_kind = 'sale' and t.deal_date >= current_date - interval '18 months' and t.deal_date < current_date - interval '12 months') >= 6
          then ((percentile_cont(0.5) within group (order by ${unit}) filter (where t.deal_kind = 'sale' and t.deal_date >= current_date - interval '6 months'))
            / nullif(percentile_cont(0.5) within group (order by ${unit}) filter (
                where t.deal_kind = 'sale' and t.deal_date >= current_date - interval '18 months' and t.deal_date < current_date - interval '12 months'), 0) - 1)::float8
        end as "change1y"
      from transactions t where ${base} and not t.is_canceled`,
    sql<RegionSignals[]>`
      select
        count(*) filter (where t.deal_kind = 'sale')::int as "saleN",
        count(*) filter (where t.deal_kind = 'sale' and ${share})::int as "shareN",
        ${med(unit, sql`t.deal_kind = 'sale' and ${share}`)} as "sharePerM2",
        ${med(unit, sql`t.deal_kind = 'sale' and not coalesce(${share}, false)`)} as "noSharePerM2",
        count(*) filter (where t.deal_kind = 'sale' and t.is_direct)::int as "directN",
        count(*) filter (where t.deal_kind = 'sale' and t.buyer_type like '%법인%')::int as "corpN",
        count(*) filter (where t.deal_kind = 'sale' and t.buyer_type is not null)::int as "corpKnown",
        count(*) filter (where t.deal_kind = 'sale' and ${y1})::int as "vol12",
        count(*) filter (where t.deal_kind = 'sale' and t.deal_date < current_date - 365 and t.deal_date >= current_date - 730)::int as "volPrev",
        count(*) filter (where t.deal_kind = 'sale' and t.jimok in ('도로', '구거', '하천', '유지', '제방'))::int as "roadN",
        count(*) filter (where t.deal_kind = 'sale' and t.jimok in ('전', '답', '과수원'))::int as "farmN",
        ${med(sql`t.price / nullif(t.land_area_m2, 0)`, sql`t.deal_kind = 'sale' and ${y1}`)} as "landPerM2_12",
        count(*) filter (where t.build_year is not null)::int as "agedKnown",
        count(*) filter (where t.build_year <= extract(year from current_date) - 30)::int as "agedN",
        ${med(unit, sql`t.deal_kind = 'jeonse' and ${y1}`)} as "jeonsePerM2",
        ${med(unit, sql`t.deal_kind = 'wolse' and ${y1}`)} as "wolseDepPerM2",
        ${med(sql`t.monthly_rent / nullif(coalesce(t.area_m2, t.land_area_m2), 0)`, sql`t.deal_kind = 'wolse' and ${y1} and t.monthly_rent > 0`)} as "rentPerM2",
        ${med(unit, sql`t.deal_kind = 'sale' and t.house_type = '집합' and t.floor = 1`)} as "groundPerM2",
        count(*) filter (where t.deal_kind = 'sale' and t.house_type = '집합' and t.floor = 1)::int as "groundN",
        ${med(unit, sql`t.deal_kind = 'sale' and t.house_type = '집합' and t.floor > 1`)} as "upperPerM2",
        count(*) filter (where t.deal_kind = 'sale' and t.house_type = '집합' and t.floor > 1)::int as "upperN"
      from transactions t
      where t.lawd_cd = ${lawd} and t.property_type = ${type} and not t.is_canceled
        and t.deal_date >= current_date - ${`${Math.max(years, 2)} years`}::interval`,
  ]);
  const typeCounts = Object.fromEntries(REGION_TYPES.map((k) => [k, typeRows.find((r) => r.type === k)?.n ?? 0])) as Record<RegionType, number>;
  return { region, type, trades, groups, zones, typeCounts, stats, signals };
}
