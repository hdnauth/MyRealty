import "server-only";
import { sql } from "../db";

export type PresaleModel = { type: string; area: number; supply_area: number | null; top_price: number; households: number | null };
export type PresaleRow = PresaleModel & {
  /** 반경 2km·최근 6개월·같은 면적대(±5%) 아파트 매매 중위(만원) */
  market: number | null;
  marketN: number;
  /** 그중 준공 10년 이내 */
  marketNew: number | null;
  gap: number | null;
  gapNew: number | null;
};

/**
 * 분양가(주택형별 최고가) vs 주변 시세. 분양가가 주변보다 낮을수록 '안전마진'이 크다.
 * 비교는 전용면적 ±5% 매매 중위로 같은 크기끼리.
 */
export async function presaleVsMarket(lng: number, lat: number, models: PresaleModel[]): Promise<PresaleRow[]> {
  return Promise.all(
    models.map(async (m) => {
      const [r] = await sql<{ market: number | null; n: number; market_new: number | null }[]>`
        select percentile_cont(0.5) within group (order by t.price)::float8 as market, count(*)::int as n,
          percentile_cont(0.5) within group (order by t.price) filter (where c.build_year >= extract(year from current_date) - 10)::float8 as market_new
        from transactions t left join complexes c on c.id = t.complex_id
        where t.property_type = 'apt' and t.deal_kind = 'sale' and not t.is_canceled
          and t.deal_date >= current_date - interval '6 months'
          and t.area_m2 between ${m.area * 0.95} and ${m.area * 1.05}
          and t.geom is not null
          and ST_DWithin(t.geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, 2000)`;
      const market = r?.n >= 3 ? r.market : null;
      const marketNew = r?.market_new ?? null;
      return {
        ...m,
        market,
        marketN: r?.n ?? 0,
        marketNew,
        gap: market ? m.top_price / market - 1 : null,
        gapNew: marketNew ? m.top_price / marketNew - 1 : null,
      };
    }),
  );
}
