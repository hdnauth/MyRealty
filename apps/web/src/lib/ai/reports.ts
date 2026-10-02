import "server-only";
import { sql } from "../db";
import { env } from "../env";
import { formatManwon } from "../format";
import { insightBalance, marketInsights } from "../insights";
import { insightInputs } from "../queries/indicators";
import { communityHighlights } from "../community/ai";
import { outlookSentiment } from "../community/queries";
import { sendMail } from "../mail";
import { requireAi } from "./client";
import { generateText } from "./engine";
import { REPORT_SYSTEM } from "./prompts";

export type ReportKind = "weekly" | "monthly";

/** 리포트용 데이터 스냅샷(모델에는 이것만 전달) */
export async function buildSnapshot(userId: string, kind: ReportKind) {
  const days = kind === "weekly" ? 7 : 31;
  const items = await sql<{ id: string; label: string; property_type: string; group_tag: string; sgg_cd: string | null; complex_id: number | null; area_m2: number | null; purchase_price: number | null; loans: { amount: number; rate: number }[] }[]>`
    select id, label, property_type, group_tag, sgg_cd, complex_id, area_m2, purchase_price, loans from watch_items where user_id = ${userId}`;
  const out = [];
  for (const it of items) {
    const vals = await sql<{ as_of: string; estimate: number; low: number; high: number; confidence: string }[]>`
      select as_of::text, estimate, low, high, confidence from valuations where watch_item_id = ${it.id}
      order by as_of desc limit 40`;
    const now = vals[0] ?? null;
    const past = vals.find((v) => new Date(v.as_of) <= new Date(Date.now() - days * 86400_000)) ?? null;
    const trades = it.complex_id
      ? await sql<{ deal_kind: string; n: number; min: number; max: number }[]>`
          select deal_kind, count(*)::int as n, min(price) as min, max(price) as max from transactions
          where complex_id = ${it.complex_id} and not is_canceled and collected_at > now() - ${`${days} days`}::interval
            and (${it.area_m2}::numeric is null or abs(area_m2 - ${it.area_m2}::numeric) <= 3)
          group by deal_kind`
      : [];
    const notes = await sql<{ kind: string; title: string }[]>`
      select kind, title from notifications where watch_item_id = ${it.id} and created_at > now() - ${`${days} days`}::interval
      order by priority desc, created_at desc limit 8`;
    const news = await sql<{ title: string; category: string; impact: number; ai_summary: string }[]>`
      select a.title, l.category, l.impact, l.ai_summary from article_links l join articles a on a.id = l.article_id
      where l.watch_item_id = ${it.id} and l.status = 'classified' and l.relevance >= 0.7
        and a.published_at > now() - ${`${days} days`}::interval
      order by l.relevance desc limit 4`;
    const [loc] = await sql<{ total: number | null }[]>`select total from location_scores where target_type = 'item' and target_id = ${it.id}`;
    out.push({
      name: it.label,
      type: it.property_type,
      group: it.group_tag,
      valuation_now: now,
      valuation_before: past,
      valuation_change: now && past ? now.estimate / past.estimate - 1 : null,
      gain_vs_purchase: now && it.purchase_price ? now.estimate / it.purchase_price - 1 : null,
      new_trades: trades,
      alerts: notes,
      news,
      location_score: loc?.total ?? null,
    });
  }
  const sggs = [...new Set(items.map((i) => i.sgg_cd).filter(Boolean))] as string[];
  const region = sggs.length
    ? await sql<{ code: string; name: string; value: number; prev: number | null; source: string }[]>`
        select s.code, s.name, s.source,
          (select value from series_values v where v.code = s.code order by period desc limit 1) as value,
          (select value from series_values v where v.code = s.code order by period desc offset 1 limit 1) as prev
        from series s where s.code = any(${sggs.flatMap((g) => [`ind.temp.${g}`, `idx.${g}`, `ind.burden.${g}`, `vol.${g}`])})`
    : [];
  const macro = await sql<{ code: string; name: string; value: number; source: string }[]>`
    select s.code, s.name, s.source, (select value from series_values v where v.code = s.code order by period desc limit 1) as value
    from series s where s.code in ('ecos.base_rate', 'ecos.mortgage_rate')`;
  const events = await sql<{ kind: string; title: string; starts_on: string }[]>`
    select kind, title, starts_on::text from events where starts_on between current_date and current_date + 30 order by starts_on limit 10`;
  // 톱다운: 전국(금리·유동성·심리·신용·공급) → 시군구(시장 해석) → 부동산. 규칙 기반 해석 결과를 그대로 넘긴다
  const national = marketInsights(await insightInputs(null)).map(({ tone, title, detail }) => ({ tone, title, detail }));
  const regions = await Promise.all(
    sggs.map(async (g) => {
      const xs = marketInsights(await insightInputs(g));
      const [nm] = await sql<{ name: string | null }[]>`select name from collect_targets where sgg_cd = ${g}`;
      return {
        sgg: g,
        name: nm?.name ?? g,
        verdict: insightBalance(xs),
        factors: xs.filter((x) => !national.some((n) => n.title === x.title)).map(({ tone, title, detail }) => ({ tone, title, detail })),
        items: items.filter((i) => i.sgg_cd === g).map((i) => i.label),
      };
    }),
  );
  // 동네 이야기: 내 지역 게시판 인기 글과 가격 전망 투표(최근 달)
  const community = await communityHighlights(sggs, days).catch(() => []);
  const communitySentiment = (
    await Promise.all(sggs.map(async (g) => ({ sgg: g, last: (await outlookSentiment(g).catch(() => [])).at(-1) ?? null })))
  ).filter((x) => x.last);
  const owned = out.filter((o) => o.group === "owned");
  const isDemo = items.some((i) => i.label.startsWith("[데모]")) || macro.some((m) => m.source === "demo");
  return {
    kind,
    period_days: days,
    is_demo: isDemo,
    unit: "금액 만원, 변화율은 비율(0.05=5%)",
    portfolio: {
      owned_count: owned.length,
      value: owned.reduce((a, o) => a + (o.valuation_now?.estimate ?? 0), 0),
      debt: items.filter((i) => i.group_tag === "owned").reduce((a, i) => a + i.loans.reduce((s, l) => s + (l.amount || 0), 0), 0),
    },
    top_down: { national, regions },
    items: out,
    region_indicators: region,
    macro,
    upcoming_events: events,
    community,
    community_sentiment: communitySentiment,
  };
}

export async function generateReport(userId: string, kind: ReportKind) {
  const cfg = await requireAi(userId);
  const snap = await buildSnapshot(userId, kind);
  const { text: md, model } = await generateText({
    cfg,
    userId,
    purpose: `report_${kind}`,
    system: REPORT_SYSTEM,
    prompt: `${kind === "weekly" ? "주간" : "월간"} 리포트를 작성하세요.\n\n${JSON.stringify(snap)}`,
    effort: "medium",
  });
  const title = `${kind === "weekly" ? "주간" : "월간"} 리포트 · ${new Date().toISOString().slice(0, 10)}`;
  const [row] = await sql<{ id: number }[]>`
    insert into ai_reports (user_id, scope, title, content_md, data, model)
    values (${userId}, ${kind}, ${title}, ${md}, ${sql.json(JSON.parse(JSON.stringify(snap)))}, ${model}) returning id`;
  return { id: row.id, title, md, snap };
}

export async function emailReport(email: string, title: string, md: string, value: number) {
  const text = `${md}\n\n보유 자산 추정 ${formatManwon(value)}\n앱에서 보기: ${env.appUrl}/ai?view=reports`;
  await sendMail(email, `[MyRealty] ${title}`, text);
}
