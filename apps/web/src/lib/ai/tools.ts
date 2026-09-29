import "server-only";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sql } from "../db";
import { scenario } from "../finance";
import { groupChange, regionChange, similarComplexes } from "../queries/comps";
import { getItem, itemAttrs, itemTransactions, summarize, median } from "../queries/items";
import { PROPERTY_TYPES } from "../property";

// 모든 도구는 로그인 사용자 범위로만 조회하고, 결과는 작게(행 수 제한) JSON 으로 돌려준다.
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x));

const INDICATOR_KEYS = {
  price_index: "idx",
  volume: "vol",
  median_84: "med84",
  jeonse_ratio: "jr",
  new_high_ratio: "nhr",
  decline_ratio: "dr",
  burden: "ind.burden",
  pir: "ind.pir",
  real_index: "ind.real",
  liquidity_index: "ind.liq",
  turnover: "ind.turnover",
  temperature: "ind.temp",
  supply: "ind.supply",
} as const;
const MACRO = ["ecos.base_rate", "ecos.mortgage_rate", "ecos.bond_3y", "ecos.cpi", "ecos.m2"] as const;

export function buildTools(userId: string) {
  const ownItem = async (id: string) => {
    const it = await getItem(userId, id);
    if (!it) throw new Error("해당 ID 의 관심 부동산이 없습니다. list_watch_items 로 확인하세요.");
    return it;
  };

  return [
    betaZodTool({
      name: "list_watch_items",
      description: "사용자가 등록한 관심 부동산 목록(ID, 이름, 유형, 그룹, 주소, 면적, 단지, 최근 추정 시세, 매입가, 시군구코드).",
      inputSchema: z.object({}),
      run: async () => {
        const rows = await sql`
          select w.id, w.label, w.property_type, w.group_tag, coalesce(w.road_address, w.jibun_address) as address,
            w.area_m2, w.land_area_m2, w.floor, w.sgg_cd, c.name as complex_name, c.build_year,
            w.purchase_price, w.purchase_date::text,
            (select json_build_object('estimate', estimate, 'low', low, 'high', high, 'as_of', as_of, 'confidence', confidence)
               from valuations v where v.watch_item_id = w.id order by as_of desc limit 1) as valuation
          from watch_items w left join complexes c on c.id = w.complex_id
          where w.user_id = ${userId} order by w.sort_order, w.created_at`;
        return json({ unit: "금액 만원, 면적 ㎡", items: rows });
      },
    }),
    betaZodTool({
      name: "get_item_detail",
      description: "관심 부동산 1건의 상세: 요약 통계(최근 매매, 6개월 중위, 1년 변화, 전세가율), 추정 시세 구간, 공시가격, 대출·임대, 건축물·토지 정보.",
      inputSchema: z.object({ item_id: z.string().describe("watch item UUID") }),
      run: async ({ item_id }) => {
        const it = await ownItem(item_id);
        const [points, attrs, vals] = await Promise.all([
          itemTransactions(it, 5),
          itemAttrs(it),
          sql`select as_of::text, estimate, low, high, method, confidence from valuations where watch_item_id = ${it.id} order by as_of desc limit 6`,
        ]);
        const s = summarize(points, new Date(), { perArea: !it.complex_id });
        return json({
          unit: "금액 만원(공시가격은 원)",
          item: { ...it, loans: it.loans, lease: it.lease },
          summary: { ...s, lastSale: s.lastSale && { date: s.lastSale.deal_date, price: s.lastSale.price, floor: s.lastSale.floor } , high: s.high && { date: s.high.deal_date, price: s.high.price } },
          valuations: vals,
          official_prices: attrs.prices.slice(-6),
          building: attrs.building?.recap ?? attrs.building?.titles?.[0] ?? null,
          parcel: attrs.parcel,
        });
      },
    }),
    betaZodTool({
      name: "query_transactions",
      description:
        "실거래 조회. item_id 를 주면 그 부동산 기준(단지·면적 또는 같은 읍면동 유사 면적), 아니면 sgg_cd(시군구 5자리)+유형으로 조회. 최대 50건과 요약 통계를 돌려준다.",
      inputSchema: z.object({
        item_id: z.string().optional(),
        sgg_cd: z.string().regex(/^\d{5}$/).optional(),
        property_type: z.enum(["apt", "officetel", "rowhouse", "house", "land", "commercial"]).optional(),
        deal_kind: z.enum(["sale", "jeonse", "wolse"]).default("sale"),
        months: z.number().int().min(1).max(120).default(12),
        area_min: z.number().optional(),
        area_max: z.number().optional(),
        limit: z.number().int().min(1).max(50).default(30),
      }),
      run: async (q) => {
        let rows: { deal_date: string; price: number; area_m2: number | null; floor: number | null; name: string | null; umd_nm: string | null; is_canceled: boolean; monthly_rent: number | null }[];
        if (q.item_id) {
          const it = await ownItem(q.item_id);
          const since = new Date();
          since.setMonth(since.getMonth() - q.months);
          rows = (await itemTransactions(it, Math.ceil(q.months / 12) + 1)).filter(
            (p) => p.deal_kind === q.deal_kind && p.deal_date >= since.toISOString().slice(0, 10),
          );
        } else {
          if (!q.sgg_cd) throw new Error("item_id 또는 sgg_cd 가 필요합니다.");
          rows = await sql`
            select deal_date::text, price, area_m2, floor, name, umd_nm, is_canceled, monthly_rent from transactions
            where sgg_cd = ${q.sgg_cd} and property_type = ${q.property_type ?? "apt"} and deal_kind = ${q.deal_kind}
              and deal_date >= current_date - ${`${q.months} months`}::interval
              and (${q.area_min ?? null}::numeric is null or area_m2 >= ${q.area_min ?? null}::numeric)
              and (${q.area_max ?? null}::numeric is null or area_m2 <= ${q.area_max ?? null}::numeric)
            order by deal_date desc limit 500`;
        }
        const valid = rows.filter((r) => !r.is_canceled);
        const prices = valid.map((r) => r.price);
        return json({
          unit: "금액 만원(전월세는 보증금)",
          summary: { count: valid.length, canceled: rows.length - valid.length, median: median(prices), min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null },
          rows: [...rows].sort((a, b) => b.deal_date.localeCompare(a.deal_date)).slice(0, q.limit),
        });
      },
    }),
    betaZodTool({
      name: "similar_complexes",
      description: "단지형 부동산의 유사 단지(유사도 점수, 거리, 준공, 평당가, 1년 변화)와 상대 성과(내 단지 vs 유사 단지 vs 시군구).",
      inputSchema: z.object({ item_id: z.string() }),
      run: async ({ item_id }) => {
        const it = await ownItem(item_id);
        const sim = await similarComplexes(it);
        const sgg = it.sgg_cd ? await regionChange(it.sgg_cd, PROPERTY_TYPES[it.property_type].tx, it.area_m2) : null;
        return json({ unit: "평당가 만원, 변화율은 비율(0.05=5%)", self: sim.self, comps: sim.comps, comps_median_change: groupChange(sim.comps), region_change: sgg });
      },
    }),
    betaZodTool({
      name: "get_indicators",
      description:
        "지역·거시 지표 시계열. sgg_cd 가 있으면 지역 지표(price_index 자체 가격지수, burden 월부담지수(%), pir, temperature 시장 온도계 0~100, jeonse_ratio, volume 등), macro=true 면 금리·CPI·M2. 월별 최근 N개월.",
      inputSchema: z.object({
        sgg_cd: z.string().regex(/^\d{5}$/).optional(),
        indicators: z.array(z.enum(Object.keys(INDICATOR_KEYS) as [keyof typeof INDICATOR_KEYS, ...(keyof typeof INDICATOR_KEYS)[]])).default(["price_index", "temperature", "burden", "volume"]),
        macro: z.boolean().default(false),
        months: z.number().int().min(3).max(120).default(24),
      }),
      run: async (q) => {
        const codes = [
          ...(q.sgg_cd ? q.indicators.map((k) => `${INDICATOR_KEYS[k]}.${q.sgg_cd}`) : []),
          ...(q.macro ? MACRO : []),
        ];
        if (!codes.length) throw new Error("sgg_cd 또는 macro=true 가 필요합니다.");
        const rows = await sql<{ code: string; name: string; unit: string | null; source: string; period: string; value: number }[]>`
          select v.code, s.name, s.unit, s.source, v.period::text, v.value from series_values v join series s on s.code = v.code
          where v.code = any(${codes}) and v.period >= date_trunc('month', current_date) - ${`${q.months} months`}::interval
          order by v.code, v.period`;
        const out: Record<string, { name: string; unit: string | null; source: string; points: [string, number][] }> = {};
        for (const r of rows) {
          out[r.code] ??= { name: r.name, unit: r.unit, source: r.source, points: [] };
          out[r.code].points.push([r.period.slice(0, 7), r.value]);
        }
        return json({ note: "source=demo 는 합성 데이터", series: out });
      },
    }),
    betaZodTool({
      name: "search_news",
      description: "관심 부동산에 연결된 뉴스(AI 관련도·카테고리·호재/악재·요약). item_id 없으면 전체 부동산.",
      inputSchema: z.object({ item_id: z.string().optional(), days: z.number().int().min(1).max(180).default(60), min_relevance: z.number().min(0).max(1).default(0.6) }),
      run: async (q) => {
        const rows = await sql`
          select w.label as item, a.title, a.source, a.published_at::date::text as date, l.category, l.impact, l.relevance, l.ai_summary, a.url
          from article_links l join articles a on a.id = l.article_id join watch_items w on w.id = l.watch_item_id
          where w.user_id = ${userId} ${q.item_id ? sql`and w.id = ${q.item_id}` : sql``}
            and l.status = 'classified' and l.relevance >= ${q.min_relevance}
            and a.published_at > now() - ${`${q.days} days`}::interval
          order by a.published_at desc limit 25`;
        return json({ impact_scale: "-2 강한 악재 ~ +2 강한 호재", articles: rows });
      },
    }),
    betaZodTool({
      name: "list_events",
      description: "일정·이벤트: 주변 청약(subscription), 입주 예정(move_in), 공시가격 발표, 세금, 금리 결정. item_id 를 주면 반경 5km.",
      inputSchema: z.object({ item_id: z.string().optional(), days_ahead: z.number().int().min(1).max(1500).default(365), kinds: z.array(z.string()).optional() }),
      run: async (q) => {
        const it = q.item_id ? await ownItem(q.item_id) : null;
        const rows = await sql`
          select kind, title, starts_on::text, ends_on::text, address, payload->>'households' as households,
            ${it?.lng != null ? sql`ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(${it.lng}, ${it.lat}), 4326)::geography)::int` : sql`null::int`} as dist_m
          from events
          where coalesce(ends_on, starts_on) >= current_date - 30 and starts_on <= current_date + ${q.days_ahead}::int
            ${q.kinds?.length ? sql`and kind = any(${q.kinds})` : sql``}
            ${it?.lng != null ? sql`and (geom is null or ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${it.lng}, ${it.lat}), 4326)::geography, 5000))` : sql``}
          order by starts_on limit 40`;
        return json({ events: rows });
      },
    }),
    betaZodTool({
      name: "get_location",
      description: "부동산의 생활편의 점수(0~100, 교통·학교·쇼핑·공원·학원·의료·음식)와 개발 요인(주변 정비구역, 신설역, 재건축 연한, 용적률 여유).",
      inputSchema: z.object({ item_id: z.string() }),
      run: async ({ item_id }) => {
        await ownItem(item_id);
        const [row] = await sql`select total, scores, development, computed_at::date::text from location_scores where target_type = 'item' and target_id = ${item_id}`;
        return json(row ?? { note: "입지 점수가 아직 계산되지 않았습니다." });
      },
    }),
    betaZodTool({
      name: "simulate_loan",
      description: "대출 시나리오 계산(원리금균등): 대출금, 월 상환액, DSR, 월부담(%). 금액 만원.",
      inputSchema: z.object({
        price: z.number().positive(),
        ltv: z.number().min(0).max(1).default(0.5),
        rate: z.number().min(0).max(20),
        years: z.number().int().min(1).max(50).default(30),
        income_annual: z.number().positive().default(7185),
        other_debt_monthly: z.number().min(0).default(0),
      }),
      run: async (q) => json(scenario({ price: q.price, ltv: q.ltv, rate: q.rate, years: q.years, incomeAnnual: q.income_annual, otherDebtMonthly: q.other_debt_monthly })),
    }),
  ];
}
