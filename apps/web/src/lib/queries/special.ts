import "server-only";
import { sql } from "../db";
import { type FarBasis, farCap } from "../far";
import type { WatchItem } from "./items";

/*
 * 유형별 추가 정보: 재개발·재건축(정비사업) 관련 부동산, 토지·임야 주변 시장.
 */

const pt = (item: WatchItem) => sql`ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)`;

export const REBUILD_AGE = 30;

export type Redevelopment = {
  zone: {
    name: string;
    kind: string;
    stage: string | null;
    stage_order: number | null;
    stage_date: string | null;
    households_now: number | null;
    households_plan: number | null;
    area_m2: number | null;
    inside: boolean;
    dist_m: number;
  } | null;
  buildYear: number | null;
  age: number | null;
  far: { current: number; cap: number; zone: string; basis: FarBasis } | null;
  /** 대지지분(㎡)과 근거 */
  landShare: { m2: number; basis: string } | null;
  /** 주변 준공 10년 이내 아파트 전용 평당가 중위(만원, 최근 1년) */
  newBuild: { ppy: number; complexes: number; n: number } | null;
  /** 주변 분양권·입주권 거래(최근 1년) */
  presale: { ppy: number | null; n: number } | null;
};

/**
 * 재개발·재건축 관련 정보. 정비구역 안(또는 200m 이내)이거나, 아파트가 재건축 연한에 가깝거나(25년+),
 * 빌라·단독이 정비구역에 걸쳐 있을 때만 의미가 있어 그 외에는 null.
 */
export async function redevelopmentInfo(item: WatchItem): Promise<Redevelopment | null> {
  if (item.lng === null || item.lat === null) return null;
  const p = pt(item);
  const [[zone], [bld], [share]] = await Promise.all([
    sql<NonNullable<Redevelopment["zone"]>[]>`
      select name, kind, stage, stage_order, stage_date::text, households_now, households_plan, area_m2::float8 as area_m2,
        ST_Intersects(geom, ${p}) as inside, ST_Distance(geom::geography, ${p}::geography)::int as dist_m
      from redevelopment_zones
      where geom is not null and ST_DWithin(geom::geography, ${p}::geography, 200)
      order by inside desc, dist_m limit 1`,
    sql<{ build_year: number | null; plat_area: number | null; households: number | null; vl_rat: number | null; zones: string[] | null }[]>`
      select
        coalesce(${item.complex_build_year}::int, (select min(left(t->>'approved_at', 4))::int from jsonb_array_elements(b.titles) t
          where t->>'approved_at' is not null)) as build_year,
        coalesce((b.recap->>'plat_area')::float8, (select max((t->>'plat_area')::float8) from jsonb_array_elements(b.titles) t)) as plat_area,
        coalesce((b.recap->>'households')::int, (select sum((t->>'households')::int) from jsonb_array_elements(b.titles) t)::int) as households,
        coalesce((b.recap->>'vl_rat')::float8, (select max((t->>'vl_rat')::float8) from jsonb_array_elements(b.titles) t)) as vl_rat,
        (select land_use_zone from parcels where pnu = ${item.pnu}) as zones
      from (select 1) x left join building_registers b on b.pnu = ${item.pnu}`,
    // 같은 단지·평형 거래의 대지권 면적(연립·다세대·단독은 실거래에 대지 면적이 있다)
    item.complex_id
      ? sql<{ m2: number | null }[]>`
          select percentile_cont(0.5) within group (order by land_area_m2)::float8 as m2 from transactions
          where complex_id = ${item.complex_id} and land_area_m2 > 0
            and (${item.area_m2}::numeric is null or abs(area_m2 - ${item.area_m2}::numeric) <= 3)`
      : Promise.resolve([{ m2: null }]),
  ]);
  const year = new Date().getFullYear();
  const buildYear = bld?.build_year ?? null;
  const age = buildYear ? year - buildYear : null;
  const isApt = item.property_type === "apt";
  const oldHousing = ["rowhouse", "house"].includes(item.property_type);
  if (!zone && !(isApt && age !== null && age >= 25) && !(oldHousing && age !== null && age >= 20)) return null;

  const cap = farCap(bld?.zones, item.sgg_cd);
  const far = bld?.vl_rat && cap ? { current: bld.vl_rat, ...cap } : null;
  const landShare = share?.m2
    ? { m2: share.m2, basis: "같은 평형 거래의 대지권 면적" }
    : item.property_type === "house" && item.land_area_m2
      ? { m2: Number(item.land_area_m2), basis: "토지 면적" }
      : bld?.plat_area && bld.households
        ? { m2: bld.plat_area / bld.households, basis: "대지면적 ÷ 세대수(평균)" }
        : null;

  const radius = Math.max(item.radius_m, 2000);
  const [[nb], [ps]] = await Promise.all([
    sql<{ ppy: number | null; complexes: number; n: number }[]>`
      select percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785))::float8 as ppy,
        count(distinct c.id)::int as complexes, count(*)::int as n
      from complexes c join transactions t on t.complex_id = c.id
      where c.property_type = 'apt' and c.build_year >= ${year - 10} and c.geom is not null
        and ST_DWithin(c.geom::geography, ${p}::geography, ${radius})
        and t.deal_kind = 'sale' and not t.is_canceled and t.area_m2 > 0 and t.deal_date >= current_date - 365`,
    sql<{ ppy: number | null; n: number }[]>`
      select percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785))::float8 as ppy, count(*)::int as n
      from transactions t
      where t.property_type = 'presale' and t.deal_kind = 'sale' and not t.is_canceled and t.area_m2 > 0
        and t.deal_date >= current_date - 365 and t.geom is not null
        and ST_DWithin(t.geom::geography, ${p}::geography, ${radius})`,
  ]);
  return {
    zone: zone ?? null,
    buildYear,
    age,
    far,
    landShare,
    newBuild: nb?.ppy ? { ppy: nb.ppy, complexes: nb.complexes, n: nb.n } : null,
    presale: ps?.n ? { ppy: ps.ppy, n: ps.n } : null,
  };
}

/** 정비사업 단계별로 확인할 것(참고용 안내) */
export function stageGuide(order: number | null | undefined): string {
  const o = order ?? 0;
  if (o <= 3) return "초기 단계(기본계획~추진위)입니다. 구역 지정·조합 설립까지 수년이 걸리고 무산될 수도 있어, 사업 기간과 주민 동의율을 확인하세요.";
  if (o === 4) return "조합이 설립됐습니다. 투기과열지구라면 조합원 지위 양도가 제한될 수 있으니 매수 전 입주권 승계 가능 여부를 확인하세요.";
  if (o === 5) return "사업시행인가 단계: 건축 계획·세대수가 정해지고 곧 종전자산 감정평가가 진행됩니다. 권리가액·분담금 추정이 가능해집니다.";
  if (o === 6) return "관리처분인가 단계: 권리가액·분담금이 확정되고 주택은 입주권으로 바뀝니다. 이주 일정과 이주비 대출 조건을 확인하세요.";
  if (o === 7) return "이주·철거 중입니다. 거주·임대가 불가하므로 보유 비용(이주비 이자)과 준공까지 기간을 계산하세요.";
  if (o === 8) return "착공했습니다. 준공까지 보통 2~4년이며, 입주권 가격은 주변 신축 시세와 분담금으로 가늠합니다.";
  return "준공 단계입니다. 입주·등기 일정과 주변 신축 시세를 비교하세요.";
}

export type LandMarket = {
  parcel: { jimok: string | null; zones: string[]; officialPerM2: number | null; officialYear: number | null } | null;
  byJimok: { jimok: string; n: number; n12m: number; perM2: number | null; area: number | null }[];
  byZone: { zone: string; n: number; perM2: number | null }[];
  /** 내 지목의 연도별 ㎡당 중위(만원) */
  trend: { year: number; n: number; perM2: number | null }[];
};

/**
 * 토지·임야 주변 시장: 반경 안 최근 3년 토지 매매를 지목·용도지역별로(㎡당 중위), 내 지목의 연도별 흐름,
 * 내 필지 개별공시지가(㎡당). 토지 실거래 좌표는 읍면동 중심이라 반경은 읍면동 단위로 걸린다.
 */
export async function landMarket(item: WatchItem): Promise<LandMarket | null> {
  if (item.lng === null || item.lat === null) return null;
  const p = pt(item);
  const near = sql`t.property_type = 'land' and t.deal_kind = 'sale' and not t.is_canceled and t.area_m2 > 0
    and t.deal_date >= current_date - interval '3 years' and t.geom is not null
    and ST_DWithin(t.geom::geography, ${p}::geography, ${item.radius_m})`;
  const [[parcel], byJimok, byZone] = await Promise.all([
    sql<{ jimok: string | null; zones: string[] | null; official: number | null; year: number | null }[]>`
      select p.jimok, p.land_use_zone as zones, o.price as official, o.year
      from (select 1) x
      left join parcels p on p.pnu = ${item.pnu}
      left join lateral (select price, year from official_prices where target_type = 'land' and target_key = ${item.pnu}
                         order by year desc limit 1) o on true`,
    sql<LandMarket["byJimok"]>`
      select coalesce(t.jimok, '미상') as jimok, count(*)::int as n,
        count(*) filter (where t.deal_date >= current_date - 365)::int as n12m,
        percentile_cont(0.5) within group (order by t.price / t.area_m2)::float8 as "perM2",
        percentile_cont(0.5) within group (order by t.area_m2)::float8 as area
      from transactions t where ${near}
      group by 1 order by n desc limit 8`,
    sql<LandMarket["byZone"]>`
      select t.land_use as zone, count(*)::int as n, percentile_cont(0.5) within group (order by t.price / t.area_m2)::float8 as "perM2"
      from transactions t where ${near} and t.land_use is not null
      group by 1 order by n desc limit 6`,
  ]);
  const jimok = item.property_type === "forest" ? "임야" : (parcel?.jimok ?? null);
  const trend = jimok
    ? await sql<LandMarket["trend"]>`
        select extract(year from t.deal_date)::int as year, count(*)::int as n,
          percentile_cont(0.5) within group (order by t.price / t.area_m2)::float8 as "perM2"
        from transactions t where ${near} and t.jimok = ${jimok}
        group by 1 order by 1`
    : [];
  return {
    parcel: parcel ? { jimok, zones: parcel.zones ?? [], officialPerM2: parcel.official, officialYear: parcel.year } : null,
    byJimok,
    byZone,
    trend,
  };
}
