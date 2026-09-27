import "server-only";
import { cache } from "react";
import { sql } from "../db";
import { PROPERTY_TYPES, type PropertyType } from "../property";

export type Loan = { name?: string; amount: number; rate: number; years?: number; type?: string; maturity?: string };
export type Lease = { kind: "jeonse" | "wolse"; deposit: number; rent?: number; end_date?: string; role?: "landlord" | "tenant" };

export type WatchItem = {
  id: string;
  user_id: string;
  property_type: PropertyType;
  label: string;
  group_tag: string;
  road_address: string | null;
  jibun_address: string | null;
  building_name: string | null;
  lawd_cd: string | null;
  sgg_cd: string | null;
  pnu: string | null;
  complex_id: number | null;
  dong_ho: string | null;
  area_m2: number | null;
  land_area_m2: number | null;
  floor: number | null;
  lng: number | null;
  lat: number | null;
  purchase_price: number | null;
  purchase_date: string | null;
  loans: Loan[];
  lease: Lease | null;
  keywords: string[];
  radius_m: number;
  alert_rules: Record<string, unknown>;
  created_at: string;
  complex_name: string | null;
  complex_households: number | null;
  complex_build_year: number | null;
  umd_nm: string | null;
};

const ITEM_COLUMNS = sql`
  w.id, w.user_id, w.property_type, w.label, w.group_tag, w.road_address, w.jibun_address, w.building_name,
  w.lawd_cd, w.sgg_cd, w.pnu, w.complex_id, w.dong_ho, w.area_m2, w.land_area_m2, w.floor,
  ST_X(w.geom) as lng, ST_Y(w.geom) as lat, w.purchase_price, w.purchase_date::text as purchase_date,
  w.loans, w.lease, w.keywords, w.radius_m, w.alert_rules, w.created_at,
  c.name as complex_name, c.households as complex_households, c.build_year as complex_build_year,
  coalesce(c.umd_nm, r.emd) as umd_nm`;

export async function listItems(userId: string) {
  return sql<(WatchItem & { estimate: number | null; est_as_of: string | null; last_trade_price: number | null; last_trade_date: string | null; unread: number })[]>`
    select ${ITEM_COLUMNS},
      v.estimate, v.as_of::text as est_as_of,
      lt.price as last_trade_price, lt.deal_date::text as last_trade_date,
      (select count(*)::int from notifications n where n.watch_item_id = w.id and n.read_at is null) as unread
    from watch_items w
    left join complexes c on c.id = w.complex_id
    left join regions r on r.lawd_cd = w.lawd_cd
    left join lateral (select estimate, as_of from valuations where watch_item_id = w.id order by as_of desc limit 1) v on true
    left join lateral (
      select t.price, t.deal_date from transactions t
      where t.complex_id = w.complex_id and w.complex_id is not null and t.deal_kind = 'sale' and not t.is_canceled
        and (w.area_m2 is null or abs(t.area_m2 - w.area_m2) <= 3)
      order by t.deal_date desc limit 1) lt on true
    where w.user_id = ${userId}
    order by w.sort_order, w.created_at`;
}

/** 요청 단위 캐시(generateMetadata 와 page 가 같은 요청에서 함께 부른다) */
export const getItem = cache(async (userId: string, id: string): Promise<WatchItem | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await sql<WatchItem[]>`
    select ${ITEM_COLUMNS}
    from watch_items w
    left join complexes c on c.id = w.complex_id
    left join regions r on r.lawd_cd = w.lawd_cd
    where w.user_id = ${userId} and w.id = ${id}`;
  return rows[0] ?? null;
});

export type TxPoint = {
  id: number;
  deal_kind: "sale" | "jeonse" | "wolse";
  deal_date: string;
  price: number;
  monthly_rent: number | null;
  area_m2: number | null;
  land_area_m2: number | null;
  floor: number | null;
  is_canceled: boolean;
  is_direct: boolean | null;
  name: string | null;
  umd_nm: string | null;
  jibun: string | null;
  jimok: string | null;
  build_year: number | null;
  house_type: string | null;
  buyer_type: string | null;
  registered_at: string | null;
  contract_type: "new" | "renewal" | null;
  prev_deposit: number | null;
  /** 계약 후 90일~2년 사이인데 등기가 없는 매매(원천에 매수자 구분이 있는 자료만) */
  unregistered: boolean;
};

const TX_COLUMNS = sql`
  t.id, t.deal_kind, t.deal_date::text as deal_date, t.price, t.monthly_rent, t.area_m2, t.land_area_m2, t.floor,
  t.is_canceled, t.is_direct, t.name, t.umd_nm, t.jibun, t.jimok, t.build_year, t.house_type,
  t.buyer_type, t.registered_at::text as registered_at, t.contract_type, t.prev_deposit,
  (t.deal_kind = 'sale' and not t.is_canceled and t.registered_at is null and t.buyer_type is not null
    and t.deal_date between current_date - 730 and current_date - 90) as unregistered`;

/**
 * 부동산 기준 거래 이력.
 * - 단지형(아파트·오피스텔·빌라): 같은 단지, 면적 ±3㎡
 * - 그 외: 같은 읍면동·유형(임야는 지목=임야), 면적 ±40%
 */
export async function itemTransactions(item: WatchItem, years = 10): Promise<TxPoint[]> {
  const since = sql`current_date - ${`${years} years`}::interval`;
  if (item.complex_id) {
    return sql<TxPoint[]>`
      select ${TX_COLUMNS} from transactions t
      where t.complex_id = ${item.complex_id} and t.deal_date >= ${since}
        and (${item.area_m2}::numeric is null or abs(t.area_m2 - ${item.area_m2}::numeric) <= 3)
      order by t.deal_date`;
  }
  const txType = PROPERTY_TYPES[item.property_type].tx;
  if (!item.lawd_cd && !item.sgg_cd) return [];
  const area = item.property_type === "land" || item.property_type === "forest" ? item.land_area_m2 ?? item.area_m2 : item.area_m2;
  return sql<TxPoint[]>`
    select ${TX_COLUMNS} from transactions t
    where t.property_type = ${txType} and t.deal_date >= ${since}
      and ${item.lawd_cd ? sql`t.lawd_cd = ${item.lawd_cd}` : sql`t.sgg_cd = ${item.sgg_cd}`}
      and (${item.property_type !== "forest"} or t.jimok = '임야')
      and (${area}::numeric is null or t.area_m2 between ${area}::numeric * 0.6 and ${area}::numeric * 1.4)
    order by t.deal_date`;
}

export type NearbyTx = TxPoint & { dist_m: number; complex_id: number | null; lng: number; lat: number };

export async function nearbyTransactions(item: WatchItem, opts: { radius?: number; months?: number; limit?: number } = {}) {
  if (item.lng === null || item.lat === null) return [];
  const radius = opts.radius ?? item.radius_m ?? 1000;
  const months = opts.months ?? 6;
  const txType = PROPERTY_TYPES[item.property_type].tx;
  return sql<NearbyTx[]>`
    select ${TX_COLUMNS}, t.complex_id, ST_X(t.geom) as lng, ST_Y(t.geom) as lat,
      ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)::geography)::int as dist_m
    from transactions t
    where t.property_type = ${txType} and t.deal_kind = 'sale' and not t.is_canceled
      and t.deal_date >= current_date - ${`${months} months`}::interval
      and t.geom is not null
      and ST_DWithin(t.geom::geography, ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)::geography, ${radius})
      and (t.complex_id is distinct from ${item.complex_id})
    order by t.deal_date desc
    limit ${opts.limit ?? 100}`;
}

export type ItemSummary = {
  lastSale: TxPoint | null;
  high: TxPoint | null;
  low1y: number | null;
  high1y: number | null;
  count3m: number;
  saleMedian6m: number | null;
  jeonseMedian6m: number | null;
  jeonseRatio: number | null;
  change1y: number | null;
  unitMedian12m: number | null; // ㎡당 중위(만원) — 단지가 없는 유형의 가치 산정용
  count12m: number;
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function monthsAgo(n: number, from = new Date()) {
  const d = new Date(from);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

/** 거래 목록에서 요약 통계(최근가, 신고가, 1년 범위, 전세가율, 1년 변화율) */
export function summarize(points: TxPoint[], now = new Date()): ItemSummary {
  const valid = points.filter((p) => !p.is_canceled && p.price);
  const sales = valid.filter((p) => p.deal_kind === "sale");
  const jeonse = valid.filter((p) => p.deal_kind === "jeonse");
  const lastSale = sales.at(-1) ?? null;
  const high = sales.reduce<TxPoint | null>((a, p) => (!a || p.price > a.price ? p : a), null);
  const y1 = monthsAgo(12, now);
  const m3 = monthsAgo(3, now);
  const m6 = monthsAgo(6, now);
  const sales1y = sales.filter((p) => p.deal_date >= y1).map((p) => p.price);
  const saleMedian6m = median(sales.filter((p) => p.deal_date >= m6).map((p) => p.price));
  const jeonseMedian6m = median(jeonse.filter((p) => p.deal_date >= m6).map((p) => p.price));
  // 1년 변화율: 최근 3개월 중위 vs 12~15개월 전 중위
  const recent = median(sales.filter((p) => p.deal_date >= m3).map((p) => p.price));
  const prior = median(sales.filter((p) => p.deal_date >= monthsAgo(15, now) && p.deal_date < y1).map((p) => p.price));
  return {
    lastSale,
    high,
    low1y: sales1y.length ? Math.min(...sales1y) : null,
    high1y: sales1y.length ? Math.max(...sales1y) : null,
    count3m: sales.filter((p) => p.deal_date >= m3).length,
    saleMedian6m,
    jeonseMedian6m,
    jeonseRatio: saleMedian6m && jeonseMedian6m ? jeonseMedian6m / saleMedian6m : null,
    change1y: recent && prior ? recent / prior - 1 : null,
    unitMedian12m: median(sales.filter((p) => p.deal_date >= y1 && p.area_m2).map((p) => p.price / Number(p.area_m2))),
    count12m: sales.filter((p) => p.deal_date >= y1).length,
  };
}

export type ItemAttrs = {
  building: { titles: Record<string, unknown>[]; recap: Record<string, unknown> | null; fetched_at: string } | null;
  parcel: {
    jimok: string | null;
    area_m2: number | null;
    land_use_zone: string[];
    road_side: string | null;
    terrain_shape: string | null;
    terrain_height: string | null;
    land_uses: { name: string; conflict?: string }[] | null;
  } | null;
  prices: { target_type: string; target_key: string; year: number; price: number; area_m2: number | null }[];
};

export async function itemAttrs(item: WatchItem): Promise<ItemAttrs> {
  if (!item.pnu) return { building: null, parcel: null, prices: [] };
  const [[b], [p], prices] = await Promise.all([
    sql<NonNullable<ItemAttrs["building"]>[]>`
      select titles, recap, fetched_at::text from building_registers where pnu = ${item.pnu}`,
    sql<NonNullable<ItemAttrs["parcel"]>[]>`
      select jimok, area_m2, land_use_zone, road_side, terrain_shape, terrain_height, land_uses from parcels where pnu = ${item.pnu}`,
    sql<ItemAttrs["prices"]>`
      select target_type, target_key, year, price, area_m2 from official_prices
      where target_key = ${item.pnu} or target_key like ${item.pnu + "|%"}
      order by target_type, year`,
  ]);
  return { building: b ?? null, parcel: p ?? null, prices };
}

export type ItemDataStatus = { trades: number; building: boolean; officialPrice: boolean; parcel: boolean; location: boolean; valuation: boolean; news: number };

/** 등록 직후 안내: 지금 볼 수 있는 데이터와 다음 수집 때 채워질 데이터 */
export async function itemDataStatus(item: WatchItem): Promise<ItemDataStatus> {
  const [[r]] = await Promise.all([
    sql<ItemDataStatus[]>`
      select
        (select count(*)::int from transactions t where t.complex_id = ${item.complex_id} and ${item.complex_id}::bigint is not null) as trades,
        exists (select 1 from building_registers b where b.pnu = ${item.pnu}) as building,
        exists (select 1 from official_prices o where o.target_key = ${item.pnu} or o.target_key like ${(item.pnu ?? "-") + "|%"}) as "officialPrice",
        exists (select 1 from parcels p where p.pnu = ${item.pnu}) as parcel,
        exists (select 1 from location_scores l where l.target_type = 'item' and l.target_id = ${item.id}) as location,
        exists (select 1 from valuations v where v.watch_item_id = ${item.id}) as valuation,
        (select count(*)::int from article_links a where a.watch_item_id = ${item.id}) as news`,
  ]);
  return r;
}

/** 단지 전체(모든 평형) 매매 — 평형별 추이 겹쳐 보기 */
export async function complexSales(complexId: number, years = 5) {
  return sql<{ deal_date: string; price: number; area_m2: number }[]>`
    select deal_date::text, price, area_m2::float8 as area_m2 from transactions
    where complex_id = ${complexId} and deal_kind = 'sale' and not is_canceled and area_m2 > 0
      and deal_date >= current_date - ${`${years} years`}::interval
    order by deal_date`;
}
