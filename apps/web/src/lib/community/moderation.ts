import "server-only";
import { z } from "zod";
import { anthropic, monthlyBudget, monthSpend, recordUsage, serverAiEnabled } from "../ai/client";
import { sql } from "../db";
import { env } from "../env";
import { sendPushToUser } from "../push";
import { getSiteSettings } from "../site-settings";
import { type Flag, POINTS } from "./rules";

/** 커뮤니티 자동 처리에 쓰는 서버 AI 모델(비용이 작은 모델) */
export const COMMUNITY_MODEL = process.env.COMMUNITY_AI_MODEL || "claude-haiku-4-5";

/** 서버 키가 있고, 관리 화면에서 켰고, 이번 달 서버 예산이 남았을 때만 */
export async function communityAiReady(feature: "moderation" | "answer"): Promise<boolean> {
  if (!serverAiEnabled()) return false;
  const s = await getSiteSettings();
  if (feature === "moderation" ? !s.communityAiModeration : !s.communityAiAnswer) return false;
  return (await monthSpend()) < monthlyBudget();
}

const Verdict = z.object({
  verdict: z.enum(["ok", "review", "block"]),
  categories: z.array(z.enum(["collusion", "ad", "abuse", "privacy", "false", "illegal"])),
  reason: z.string(),
});
export type AiVerdict = z.infer<typeof Verdict>;

const SYSTEM = `당신은 한국 부동산 커뮤니티의 게시물 검토자입니다. 글이 운영 원칙을 어기는지 판단합니다.
- collusion: 집값 담합(특정 가격 이하 매도·중개 의뢰 금지 유도, 특정 중개사무소 배제·불매, 저가 매물 허위 신고 유도). 공인중개사법 제33조 제2항 위반. 담합이 "불법이다"라고 논하는 글은 위반이 아니다.
- ad: 광고·영업·중개 홍보, 리딩방, 분양 영업, 연락처로 유도
- abuse: 욕설·비방·혐오·특정인 공격
- privacy: 특정 세대·개인을 알아볼 수 있는 정보
- false: 명백한 허위 사실 유포(근거 없는 단정적 루머)
- illegal: 그 밖의 불법 정보
판정: ok(문제 없음), review(사람이 확인할 필요), block(명백한 위반, 바로 가림).
가격 의견·비관/낙관 전망·정책 비판·단지 장단점 평가는 자유로운 의견이므로 ok 입니다. 확신이 없으면 review.
reason 은 한국어 한 문장.`;

/** AI 검토. 실패하면 null(규칙 판정을 그대로 쓴다) */
export async function aiReview(text: string): Promise<AiVerdict | null> {
  try {
    const msg = await anthropic().messages.create({
      model: COMMUNITY_MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `다음 게시물을 판정하고 JSON 하나만 출력하세요: {"verdict":"ok|review|block","categories":[...],"reason":"..."}\n\n<post>\n${text.slice(0, 4000)}\n</post>`,
        },
      ],
    });
    await recordUsage("community_moderation", msg.model, msg.usage);
    const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = Verdict.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch (e) {
    console.warn("community ai review failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 저장 후 AI 검토(응답을 보낸 뒤 after() 에서 실행). 규칙이 보류한 글은 AI 가 ok 면 공개,
 * 규칙을 통과한 글은 AI 가 block 이면 가리고 review 면 보류.
 */
export async function reviewAfterSave(target: "post" | "comment", id: number, text: string, ruleHeld: boolean, flags: Flag[]) {
  if (!(await communityAiReady("moderation"))) return;
  const v = await aiReview(text);
  if (!v) return;
  const next = v.verdict === "block" ? "hidden" : v.verdict === "review" ? "held" : ruleHeld ? "visible" : null;
  const moderation = { flags, ai: { verdict: v.verdict, categories: v.categories, reason: v.reason }, at: new Date().toISOString() };
  const table = target === "post" ? sql`community_posts` : sql`community_comments`;
  // 그 사이 관리자가 처리했으면(by 가 있으면) 상태는 건드리지 않는다
  await sql`
    update ${table} set moderation = ${sql.json(moderation)},
      status = case when moderation ? 'by' or status = 'deleted' then status else coalesce(${next}, status) end
    where id = ${id}`;
  if (target === "comment" && next && next !== "visible") await recountComments(id);
}

/** 댓글 상태가 바뀌면 글의 댓글 수를 다시 센다 */
export async function recountComments(commentId: number) {
  await sql`
    update community_posts p set comment_count = (select count(*) from community_comments m where m.post_id = p.id and m.status = 'visible')
    where p.id = (select post_id from community_comments where id = ${commentId})`;
}

export async function addPoints(userId: string | null, delta: number) {
  if (!userId || !delta) return;
  await sql`update users set community_points = community_points + ${delta} where id = ${userId}`;
}

/**
 * 커뮤니티 알림: notifications 에 남기고, 푸시를 켠 사용자에게는 바로 보낸다(댓글은 대화라 하루 1회 배치로는 늦다).
 */
export async function notifyCommunity(o: { userId: string; kind: "community_reply" | "community_hot" | "community_mod"; title: string; body: string; url: string; dedupe: string; push?: boolean }) {
  const [row] = await sql<{ id: number; push: boolean }[]>`
    insert into notifications (user_id, kind, title, body, url, priority, dedupe_key)
    values (${o.userId}, ${o.kind}, ${o.title}, ${o.body}, ${o.url}, 1, ${o.dedupe})
    on conflict (user_id, dedupe_key) do nothing
    returning id, (select coalesce((settings->>'pushEnabled')::boolean, true) and coalesce((settings->>'communityPush')::boolean, true) from users where id = ${o.userId}) as push`;
  if (!row || !o.push || !row.push) return;
  try {
    const r = await sendPushToUser(o.userId, { title: o.title, body: o.body, url: o.url, tag: `n${row.id}` });
    if (r.sent) await sql`update notifications set pushed_at = now() where id = ${row.id}`;
  } catch (e) {
    console.warn("community push failed", e instanceof Error ? e.message : e);
  }
}

export const postUrl = (id: number, commentId?: number) => `/community/posts/${id}${commentId ? `#c${commentId}` : ""}`;

/** 관리자 처리로 가려진 글·댓글 작성자 점수 감점 */
export const hiddenPenalty = POINTS.hidden;

export const appUrl = env.appUrl;
