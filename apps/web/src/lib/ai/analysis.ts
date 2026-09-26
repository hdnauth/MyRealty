import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sql } from "../db";
import { groupChange, similarComplexes } from "../queries/comps";
import { itemAttrs, itemTransactions, summarize, type WatchItem } from "../queries/items";
import { anthropic, budgetOk, effortConfig, fallbackParams, MODEL, recordUsage } from "./client";
import { ANALYSIS_SYSTEM, todayLine } from "./prompts";

export const AnalysisCard = z.object({
  one_liner: z.string().describe("물건 현황 한 문장 요약"),
  strengths: z.array(z.string()).describe("데이터 근거가 있는 강점 2~5개"),
  risks: z.array(z.string()).describe("데이터 근거가 있는 리스크 2~5개"),
  checklist: z.array(z.string()).describe("이 유형에서 직접 확인해야 할 항목 3~6개"),
  factors: z
    .array(z.object({ factor: z.string(), direction: z.enum(["positive", "negative", "neutral"]), note: z.string() }))
    .describe("가치에 영향을 주는 요인(금리·공급·개발·입지 등)"),
  data_gaps: z.array(z.string()).describe("판단에 부족한 데이터"),
});
export type AnalysisCard = z.infer<typeof AnalysisCard>;

export async function itemSnapshot(item: WatchItem) {
  const [points, attrs, vals, loc, sim, news, region] = await Promise.all([
    itemTransactions(item, 5),
    itemAttrs(item),
    sql`select as_of::text, estimate, low, high, method, confidence from valuations where watch_item_id = ${item.id} order by as_of desc limit 12`,
    sql`select total, scores, development from location_scores where target_type = 'item' and target_id = ${item.id}`,
    similarComplexes(item),
    sql`select a.title, l.category, l.impact, l.relevance, l.ai_summary, a.published_at::date::text as date
        from article_links l join articles a on a.id = l.article_id
        where l.watch_item_id = ${item.id} and l.status = 'classified' and l.relevance >= 0.6
        order by a.published_at desc limit 8`,
    item.sgg_cd
      ? sql`select s.code, s.name, s.source, (select value from series_values v where v.code = s.code order by period desc limit 1) as value
            from series s where s.code = any(${["ind.temp", "ind.burden", "ind.pir", "jr", "ind.supply"].map((k) => `${k}.${item.sgg_cd}`)})`
      : Promise.resolve([]),
  ]);
  const s = summarize(points);
  return {
    unit: "금액 만원(공시가격은 원), 비율은 0~1",
    item: {
      name: item.label,
      type: item.property_type,
      group: item.group_tag,
      address: item.road_address ?? item.jibun_address,
      area_m2: item.area_m2 ?? item.land_area_m2,
      floor: item.floor,
      complex: item.complex_name,
      build_year: item.complex_build_year,
      households: item.complex_households,
      purchase_price: item.purchase_price,
      purchase_date: item.purchase_date,
      loans: item.loans,
      lease: item.lease,
    },
    market: {
      last_sale: s.lastSale && { date: s.lastSale.deal_date, price: s.lastSale.price },
      median_6m: s.saleMedian6m,
      change_1y: s.change1y,
      high_all_time: s.high && { date: s.high.deal_date, price: s.high.price },
      jeonse_ratio: s.jeonseRatio,
      trades_3m: s.count3m,
      unit_median_12m_per_m2: s.unitMedian12m,
    },
    valuations: vals,
    official_prices: attrs.prices.slice(-4),
    building: attrs.building?.recap ?? null,
    parcel: attrs.parcel,
    location: loc[0] ?? null,
    comps: { self_change: sim.self?.change ?? null, comps_median_change: groupChange(sim.comps), top: sim.comps.slice(0, 5) },
    news,
    region,
  };
}

export async function generateAnalysis(userId: string, item: WatchItem) {
  if (!(await budgetOk())) throw new Error("이번 달 AI 예산을 모두 사용했습니다.");
  const snap = await itemSnapshot(item);
  const msg = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: [
      { type: "text", text: ANALYSIS_SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: todayLine() },
    ],
    messages: [{ role: "user", content: `다음 물건의 분석 카드를 작성하세요.\n\n${JSON.stringify(snap)}` }],
    output_config: { format: betaZodOutputFormat(AnalysisCard), ...effortConfig("high") },
    ...fallbackParams(),
  });
  await recordUsage("item_analysis", msg.model, msg.usage);
  if (msg.stop_reason === "refusal" || !msg.parsed_output) throw new Error("분석을 생성하지 못했습니다.");
  const card = msg.parsed_output;
  await sql`insert into ai_reports (user_id, scope, target_ids, title, content_md, data, model)
            values (${userId}, 'item', ${[item.id]}, ${card.one_liner}, '', ${sql.json({ card } as never)}, ${msg.model})`;
  return card;
}

export async function latestAnalysis(userId: string, itemId: string) {
  const [r] = await sql<{ data: { card: AnalysisCard }; created_at: string; model: string | null }[]>`
    select data, created_at::text, model from ai_reports
    where user_id = ${userId} and scope = 'item' and ${itemId} = any(target_ids) order by created_at desc limit 1`;
  return r ?? null;
}
