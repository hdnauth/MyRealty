import "server-only";
import { anthropic, effortConfig, fallbackParams, MODEL, recordUsage, requireAi, textOf } from "../ai/client";
import { generateText } from "../ai/engine";
import { todayLine } from "../ai/prompts";
import { sql } from "../db";
import { communityAiReady, notifyCommunity, postUrl } from "./moderation";
import { sggNames } from "./queries";

/** 단지·시군구 데이터 요약(AI 에 넘길 근거). 금액 단위 만원 */
export async function boardContext(sgg: string, complexId: number | null) {
  const [names, complex, areas, recent, loc, region, events] = await Promise.all([
    sggNames([sgg]),
    complexId
      ? sql<{ name: string; property_type: string; build_year: number | null; households: number | null; umd_nm: string | null }[]>`
          select name, property_type, build_year, households, umd_nm from complexes where id = ${complexId}`
      : Promise.resolve([]),
    complexId
      ? sql<{ area: number; trades: number; median: number; prev_median: number | null }[]>`
          with g as (
            select round(area_m2)::int as area, count(*)::int as trades, percentile_cont(0.5) within group (order by price)::int as median
            from transactions where complex_id = ${complexId} and deal_kind = 'sale' and not is_canceled and deal_date > current_date - 365
            group by 1 order by trades desc limit 4
          )
          select g.*, (select percentile_cont(0.5) within group (order by x.price)::int from transactions x
                       where x.complex_id = ${complexId} and x.deal_kind = 'sale' and not x.is_canceled
                         and abs(x.area_m2 - g.area) <= 3 and x.deal_date between current_date - 730 and current_date - 365) as prev_median
          from g`
      : Promise.resolve([]),
    complexId
      ? sql<{ deal_kind: string; deal_date: string; price: number; monthly_rent: number | null; area_m2: number; floor: number | null }[]>`
          select deal_kind, deal_date::text, price, monthly_rent, area_m2::float8 as area_m2, floor from transactions
          where complex_id = ${complexId} and not is_canceled order by deal_date desc limit 8`
      : Promise.resolve([]),
    complexId ? sql<{ total: number | null }[]>`select total from location_scores where target_type = 'complex' and target_id = ${String(complexId)}` : Promise.resolve([]),
    sql<{ code: string; name: string; value: number | null; year_ago: number | null }[]>`
      select s.code, s.name,
             (select value from series_values v where v.code = s.code order by period desc limit 1) as value,
             (select value from series_values v where v.code = s.code order by period desc offset 12 limit 1) as year_ago
      from series s where s.code = any(${[`ind.temp.${sgg}`, `idx.${sgg}`, `jr.${sgg}`, `ind.burden.${sgg}`, `vol.${sgg}`, `med84.${sgg}`]})`,
    sql<{ kind: string; title: string; starts_on: string | null }[]>`
      select kind, title, starts_on::text from events where coalesce(sgg_cd, left(lawd_cd, 5)) = ${sgg} and (starts_on is null or starts_on >= current_date - 30)
      order by starts_on nulls last limit 5`,
  ]);
  return {
    region: names[sgg] ?? sgg,
    complex: complex[0] ? { ...complex[0], location_score: loc[0]?.total ?? null, sale_by_area_last_12m: areas, recent_trades: recent } : null,
    region_indicators: region,
    upcoming_events: events,
    unit: "금액 만원, 면적 ㎡",
  };
}

const ANSWER_SYSTEM = `당신은 부동산 커뮤니티에서 질문에 첫 답변을 다는 데이터 도우미입니다.
- 주어진 데이터(실거래·지표·일정)만 근거로, 질문에 직접 답하는 3~6문장을 한국어로 씁니다. 숫자는 "25억 3000만"처럼 읽기 쉽게.
- 데이터로 답할 수 없는 부분(학군 분위기, 주차, 관리 상태 등 생활 정보)은 "주민분들의 답을 기다려 봅니다"처럼 사람 답변을 청합니다.
- 매수·매도 권유, 가격 예측 단정, 특정 중개사·매물 언급은 하지 않습니다. 투자 자문이 아님을 굳이 반복하지 않습니다.
- Markdown 제목·표는 쓰지 말고 짧은 문단 또는 2~4개의 "- " 목록만 씁니다.`;

/** 질문 글에 AI 첫 답변(서버 AI). 관리 화면에서 끌 수 있고 서버 예산 안에서만 */
export async function answerQuestion(postId: number) {
  if (!(await communityAiReady("answer"))) return;
  const [p] = await sql<{ title: string; body: string; sgg_cd: string; complex_id: number | null; status: string; user_id: string | null; category: string }[]>`
    select title, body, sgg_cd, complex_id, status, user_id, category from community_posts where id = ${postId}`;
  if (!p || p.category !== "question" || p.status !== "visible") return;
  const ctx = await boardContext(p.sgg_cd, p.complex_id);
  try {
    const msg = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: [
        { type: "text", text: ANSWER_SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: todayLine() },
      ],
      messages: [{ role: "user", content: `<question>\n제목: ${p.title}\n${p.body.slice(0, 3000)}\n</question>\n\n<data>\n${JSON.stringify(ctx)}\n</data>` }],
      output_config: effortConfig("low", MODEL),
      ...fallbackParams(MODEL),
    });
    await recordUsage("community_answer", msg.model, msg.usage);
    const text = textOf(msg.content).trim();
    if (!text || msg.stop_reason === "refusal") return;
    const [c] = await sql<{ id: number }[]>`
      insert into community_comments (post_id, kind, body) values (${postId}, 'ai', ${text.slice(0, 2000)}) returning id`;
    await sql`update community_posts set comment_count = comment_count + 1, last_activity_at = now() where id = ${postId}`;
    if (p.user_id) {
      await notifyCommunity({
        userId: p.user_id,
        kind: "community_reply",
        title: `AI 데이터 답변: ${p.title}`.slice(0, 80),
        body: text.replace(/\s+/g, " ").slice(0, 100),
        url: postUrl(postId, c.id),
        dedupe: `reply:${c.id}`,
        push: false,
      });
    }
  } catch (e) {
    console.warn("community ai answer failed", e instanceof Error ? e.message : e);
  }
}

const FAQ_SYSTEM = `부동산 커뮤니티의 한 단지 이야기 글·댓글을 읽고 "이 단지 FAQ"를 만듭니다.
- 자주 나온 주제(교통·학군·주차·관리·소음·시세 흐름·재건축 등)별로 "### 질문" + 2~4문장 답 형식, 4~8개.
- 글에 실제로 나온 내용만 쓰고, 의견이 갈리면 "의견이 갈립니다"라고 양쪽을 짧게 적습니다. 개인을 특정하지 않습니다.
- 마지막 줄에 "※ 주민 글을 요약한 것으로 사실과 다를 수 있습니다." 를 붙입니다.`;

const WEEK_SYSTEM = `부동산 커뮤니티의 한 시군구 게시판에서 지난 7일 글을 읽고 "이번 주 동네 이야기"를 요약합니다.
- 3~6개의 "- " 목록: 많이 이야기된 주제, 눈에 띄는 정보, 의견 흐름(낙관/비관). 각 항목 1~2문장.
- 글에 나온 내용만, 개인을 특정하지 않고, 매수·매도 권유 없이.`;

async function collectThreads(where: ReturnType<typeof sql>, limit: number) {
  const posts = await sql<{ id: number; category: string; title: string; body: string; like_count: number; comment_count: number; created_at: string }[]>`
    select id, category, title, left(body, 800) as body, like_count, comment_count, created_at::date::text as created_at
    from community_posts p where p.status = 'visible' and p.kind = 'user' and ${where}
    order by (like_count * 2 + comment_count * 3) desc, created_at desc limit ${limit}`;
  if (!posts.length) return [];
  const comments = await sql<{ post_id: number; body: string }[]>`
    select post_id, left(body, 300) as body from community_comments
    where post_id = any(${posts.map((p) => p.id)}) and status = 'visible' and kind = 'user' order by like_count desc, created_at limit 200`;
  return posts.map((p) => ({ ...p, comments: comments.filter((c) => c.post_id === p.id).slice(0, 6).map((c) => c.body) }));
}

/** 단지 FAQ / 시군구 주간 요약 생성(요청한 사용자의 AI 설정 사용). 12시간 안에 만든 것이 있으면 그대로 */
export async function buildSummary(userId: string, scope: "complex_faq" | "sgg_week", id: string, force = false) {
  const [cached] = await sql<{ fresh: boolean }[]>`
    select updated_at > now() - interval '12 hours' as fresh from community_summaries where scope = ${scope} and scope_id = ${id}`;
  if (cached?.fresh && !force) return { cached: true };
  const threads =
    scope === "complex_faq"
      ? await collectThreads(sql`p.complex_id = ${Number(id)}`, 40)
      : await collectThreads(sql`p.sgg_cd = ${id} and p.created_at > now() - interval '7 days'`, 30);
  if (threads.length < (scope === "complex_faq" ? 3 : 1)) {
    throw new Error(scope === "complex_faq" ? "FAQ 를 만들려면 이 단지 이야기 글이 3개 이상 필요합니다." : "지난 7일 동안 올라온 글이 없습니다.");
  }
  const cfg = await requireAi(userId);
  const { text, model } = await generateText({
    cfg,
    userId,
    purpose: `community_${scope}`,
    system: scope === "complex_faq" ? FAQ_SYSTEM : WEEK_SYSTEM,
    prompt: JSON.stringify(threads),
    maxTokens: 2500,
    effort: "low",
  });
  await sql`
    insert into community_summaries (scope, scope_id, content_md, post_count, model, generated_by)
    values (${scope}, ${id}, ${text}, ${threads.length}, ${model}, ${userId})
    on conflict (scope, scope_id) do update set content_md = excluded.content_md, post_count = excluded.post_count,
      model = excluded.model, generated_by = excluded.generated_by, updated_at = now()`;
  return { cached: false };
}

/** 주간 리포트용: 내 지역 게시판에서 지난 기간 인기 글(제목·말머리·반응) */
export async function communityHighlights(sggs: string[], days: number) {
  if (!sggs.length) return [];
  return sql<{ sgg_cd: string; category: string; title: string; excerpt: string; likes: number; comments: number }[]>`
    select sgg_cd, category, title, left(regexp_replace(body, '\\s+', ' ', 'g'), 160) as excerpt, like_count as likes, comment_count as comments
    from community_posts
    where sgg_cd = any(${sggs}) and status = 'visible' and created_at > now() - ${`${days} days`}::interval
    order by (like_count * 2 + comment_count * 3) desc, created_at desc limit 8`;
}
