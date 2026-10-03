"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { ensureUser, requireMember, requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { answerQuestion, buildSummary } from "@/lib/community/ai";
import { addPoints, notifyCommunity, postUrl, recountComments, reviewAfterSave } from "@/lib/community/moderation";
import { type Attachment, canWrite, communityMe } from "@/lib/community/queries";
import { ALL_BOARD, dailyLimit, isReportReason, isSgg, isUserCategory, LIMITS, nicknameError, POINTS, screenText } from "@/lib/community/rules";
import { getSiteSettings } from "@/lib/site-settings";

export type FormState = { error?: string; ok?: string };

const str = (v: FormDataEntryValue | null) => (v === null ? "" : String(v)).trim();

/** 글쓰기 전 공통 확인: 커뮤니티 열림, 닉네임·동의, 작성 제한 */
async function writer() {
  const user = await requireMember();
  const [me, site] = await Promise.all([communityMe(user.id, user.isAdmin), getSiteSettings()]);
  if (!site.communityEnabled && !user.isAdmin) return { error: "지금은 커뮤니티 글쓰기가 잠시 중단되어 있습니다." } as const;
  if (!canWrite(me)) return { error: "닉네임을 정하고 운영 원칙에 동의해야 글을 쓸 수 있습니다." } as const;
  if (me.mutedUntil) return { error: `운영 원칙 위반으로 ${me.mutedUntil.slice(0, 10)}까지 글·댓글 작성이 제한되었습니다.` } as const;
  return { user, me } as const;
}

async function rateError(kind: "post" | "comment", uid: string, createdAt: string): Promise<string | null> {
  const table = kind === "post" ? sql`community_posts` : sql`community_comments`;
  const [r] = await sql<{ day: number; last: number | null }[]>`
    select count(*) filter (where created_at > now() - interval '1 day')::int as day,
           extract(epoch from now() - max(created_at))::float8 as last
    from ${table} where user_id = ${uid} and created_at > now() - interval '1 day'`;
  const limit = dailyLimit(kind, new Date(createdAt));
  if (r.day >= limit) return `하루에 ${kind === "post" ? "글" : "댓글"}은 ${limit}개까지 쓸 수 있습니다.${limit <= 20 && kind === "post" ? " (가입 첫날은 적게 제한됩니다)" : ""}`;
  const gap = kind === "post" ? LIMITS.postGapSec : LIMITS.commentGapSec;
  if (r.last !== null && r.last < gap) return `너무 빠르게 쓰고 있습니다. ${Math.ceil(gap - r.last)}초 뒤에 다시 시도하세요.`;
  return null;
}

/** 폼의 첨부 JSON 검증: 존재하는 거래·단지·지표, 내가 올린 이미지만 */
async function readAttachments(raw: string, uid: string, postId: number | null): Promise<Attachment[] | { error: string }> {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return { error: "첨부 정보를 읽을 수 없습니다." };
  }
  if (!Array.isArray(arr)) return [];
  const out: Attachment[] = [];
  for (const a of arr.slice(0, 10)) {
    if (a?.type === "trade" && Number.isSafeInteger(a.id)) out.push({ type: "trade", id: a.id });
    else if (a?.type === "complex" && Number.isSafeInteger(a.id)) out.push({ type: "complex", id: a.id, area: Number.isFinite(a.area) ? a.area : null });
    else if (a?.type === "series" && typeof a.code === "string" && /^[\w.]{1,60}$/.test(a.code)) out.push({ type: "series", code: a.code });
    else if (a?.type === "image" && typeof a.id === "string" && /^[0-9a-f-]{36}$/.test(a.id)) out.push({ type: "image", id: a.id });
  }
  const images = out.filter((a) => a.type === "image").map((a) => (a as { id: string }).id);
  if (images.length > LIMITS.imagesPerPost) return { error: `사진은 ${LIMITS.imagesPerPost}장까지 붙일 수 있습니다.` };
  if (images.length) {
    const ok = await sql<{ id: string }[]>`
      select id from community_images where id = any(${images}::uuid[]) and user_id = ${uid} and (post_id is null or post_id = ${postId})`;
    if (ok.length !== images.length) return { error: "사진을 다시 올려 주세요." };
  }
  const trades = out.filter((a) => a.type === "trade").map((a) => (a as { id: number }).id);
  if (trades.length) {
    const ok = await sql`select id from transactions where id = any(${trades})`;
    if (ok.length !== trades.length) return { error: "첨부한 거래를 찾을 수 없습니다." };
  }
  return out;
}

function readPoll(form: FormData): { question: string; options: string[]; kind: "custom" | "outlook"; days: number } | null | { error: string } {
  const kind = str(form.get("poll_kind"));
  if (!kind) return null;
  if (kind === "outlook") return { kind, question: "1년 뒤 이 지역(단지) 집값은 어떻게 될까요?", options: ["오른다", "비슷하다", "내린다"], days: 30 };
  const question = str(form.get("poll_question")).slice(0, 100);
  const options = form.getAll("poll_option").map((o) => String(o).trim().slice(0, 40)).filter(Boolean);
  if (!question) return { error: "투표 질문을 입력하세요." };
  if (options.length < 2) return { error: "투표 항목을 2개 이상 입력하세요." };
  if (options.length > LIMITS.pollOptionsMax) return { error: `투표 항목은 ${LIMITS.pollOptionsMax}개까지입니다.` };
  const days = Math.min(30, Math.max(1, Number(form.get("poll_days")) || 7));
  return { kind: "custom", question, options, days };
}

/** 게시판 위치: 단지가 있으면 단지의 시군구, 아니면 시군구 */
async function readBoard(form: FormData): Promise<{ sgg: string; complexId: number | null } | { error: string }> {
  const complexId = Number(form.get("complex_id")) || null;
  if (complexId) {
    const [c] = await sql<{ sgg: string }[]>`select sgg_cd as sgg from complexes where id = ${complexId}`;
    if (!c) return { error: "단지를 찾을 수 없습니다." };
    return { sgg: c.sgg, complexId };
  }
  const sgg = str(form.get("sgg"));
  if (!isSgg(sgg)) return { error: "게시판(시군구)을 고르세요." };
  if (sgg === ALL_BOARD) return { sgg, complexId: null };
  const [ok] = await sql`
    select 1 from collect_targets where sgg_cd = ${sgg}
    union all select 1 from regions where lawd_cd = ${`${sgg}00000`}
    union all select 1 from complexes where sgg_cd = ${sgg} limit 1`;
  if (!ok) return { error: "알 수 없는 시군구입니다." };
  return { sgg, complexId: null };
}

export async function createPostAction(_: FormState, form: FormData): Promise<FormState> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { user, me } = w;
  const category = str(form.get("category"));
  if (!isUserCategory(category)) return { error: "말머리를 고르세요." };
  const title = str(form.get("title"));
  const body = str(form.get("body"));
  if (title.length < 2) return { error: "제목을 2자 이상 입력하세요." };
  if (title.length > LIMITS.titleMax) return { error: `제목은 ${LIMITS.titleMax}자까지입니다.` };
  if (body.length > LIMITS.bodyMax) return { error: `본문은 ${LIMITS.bodyMax.toLocaleString()}자까지입니다.` };
  const board = await readBoard(form);
  if ("error" in board) return board;
  const rate = await rateError("post", user.id, me.createdAt);
  if (rate) return { error: rate };
  const atts = await readAttachments(str(form.get("attachments")), user.id, null);
  if ("error" in atts) return atts;
  const poll = readPoll(form);
  if (poll && "error" in poll) return poll;
  if (!body && !atts.length && !poll) return { error: "본문을 입력하세요." };

  const t = screenText(title);
  const b = screenText(body);
  const flags = [...t.flags, ...b.flags.filter((f) => !t.flags.some((x) => x.label === f.label))];
  const held = t.action === "hold" || b.action === "hold";
  const id = await sql.begin(async (tx) => {
    const [p] = await tx<{ id: number }[]>`
      insert into community_posts (user_id, sgg_cd, complex_id, category, title, body, attachments, status, moderation)
      values (${user.id}, ${board.sgg}, ${board.complexId}, ${category}, ${t.text}, ${b.text}, ${tx.json(atts as never)},
              ${held ? "held" : "visible"}, ${tx.json({ flags } as never)})
      returning id`;
    const images = atts.filter((a) => a.type === "image").map((a) => (a as { id: string }).id);
    if (images.length) await tx`update community_images set post_id = ${p.id} where id = any(${images}::uuid[]) and user_id = ${user.id}`;
    if (poll) {
      await tx`insert into community_polls (post_id, kind, question, options, closes_at)
               values (${p.id}, ${poll.kind}, ${poll.question}, ${poll.options}, now() + ${`${poll.days} days`}::interval)`;
    }
    await tx`update users set community_points = community_points + ${POINTS.post} where id = ${user.id}`;
    return p.id;
  });
  after(async () => {
    await reviewAfterSave("post", id, `${t.text}\n\n${b.text}`, held, flags);
    if (category === "question") await answerQuestion(id);
  });
  redirect(`${postUrl(id)}${held ? "?held=1" : ""}`);
}

export async function updatePostAction(postId: number, _: FormState, form: FormData): Promise<FormState> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { user } = w;
  const [p] = await sql<{ user_id: string | null; status: string; kind: string }[]>`select user_id, status, kind from community_posts where id = ${postId}`;
  if (!p || p.user_id !== user.id || p.kind !== "user" || p.status === "deleted") return { error: "수정할 수 없는 글입니다." };
  if (p.status === "hidden") return { error: "운영 원칙 위반으로 가려진 글은 수정할 수 없습니다." };
  const category = str(form.get("category"));
  if (!isUserCategory(category)) return { error: "말머리를 고르세요." };
  const title = str(form.get("title"));
  const body = str(form.get("body"));
  if (title.length < 2 || title.length > LIMITS.titleMax) return { error: `제목은 2~${LIMITS.titleMax}자로 입력하세요.` };
  if (body.length > LIMITS.bodyMax) return { error: `본문은 ${LIMITS.bodyMax.toLocaleString()}자까지입니다.` };
  const atts = await readAttachments(str(form.get("attachments")), user.id, postId);
  if ("error" in atts) return atts;
  const t = screenText(title);
  const b = screenText(body);
  const flags = [...t.flags, ...b.flags.filter((f) => !t.flags.some((x) => x.label === f.label))];
  const held = t.action === "hold" || b.action === "hold";
  await sql.begin(async (tx) => {
    await tx`
      update community_posts set category = ${category}, title = ${t.text}, body = ${b.text}, attachments = ${tx.json(atts as never)},
        status = ${held ? "held" : "visible"}, moderation = ${tx.json({ flags } as never)}, edited_at = now()
      where id = ${postId}`;
    const images = atts.filter((a) => a.type === "image").map((a) => (a as { id: string }).id);
    await tx`delete from community_images where post_id = ${postId} and not (id = any(${images}::uuid[]))`;
    if (images.length) await tx`update community_images set post_id = ${postId} where id = any(${images}::uuid[]) and user_id = ${user.id}`;
  });
  after(() => reviewAfterSave("post", postId, `${t.text}\n\n${b.text}`, held, flags));
  redirect(`${postUrl(postId)}${held ? "?held=1" : ""}`);
}

export async function deletePostAction(postId: number) {
  const user = await requireUser();
  const [p] = await sql<{ user_id: string | null; sgg_cd: string; complex_id: number | null }[]>`
    update community_posts set status = 'deleted' where id = ${postId} and (user_id = ${user.id} or ${user.isAdmin}) and status <> 'deleted'
    returning user_id, sgg_cd, complex_id`;
  if (p?.user_id === user.id) await addPoints(user.id, -POINTS.post);
  redirect(p?.complex_id ? `/community?complex=${p.complex_id}` : p ? `/community?sgg=${p.sgg_cd}` : "/community");
}

export async function createCommentAction(postId: number, parentId: number | null, _: FormState, form: FormData): Promise<FormState> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { user, me } = w;
  const body = str(form.get("body"));
  if (!body) return { error: "댓글을 입력하세요." };
  if (body.length > LIMITS.commentMax) return { error: `댓글은 ${LIMITS.commentMax.toLocaleString()}자까지입니다.` };
  const [post] = await sql<{ user_id: string | null; title: string; status: string }[]>`select user_id, title, status from community_posts where id = ${postId}`;
  if (!post || post.status !== "visible") return { error: "댓글을 달 수 없는 글입니다." };
  let parentAuthor: string | null = null;
  if (parentId) {
    const [pc] = await sql<{ user_id: string | null; parent_id: number | null; post_id: number }[]>`
      select user_id, parent_id, post_id from community_comments where id = ${parentId}`;
    if (!pc || pc.post_id !== postId) return { error: "답글을 달 댓글을 찾을 수 없습니다." };
    if (pc.parent_id) parentId = pc.parent_id; // 대댓글은 한 단계까지
    parentAuthor = pc.user_id;
  }
  const rate = await rateError("comment", user.id, me.createdAt);
  if (rate) return { error: rate };
  const s = screenText(body);
  const held = s.action === "hold";
  const [c] = await sql<{ id: number }[]>`
    insert into community_comments (post_id, parent_id, user_id, body, status, moderation)
    values (${postId}, ${parentId}, ${user.id}, ${s.text}, ${held ? "held" : "visible"}, ${sql.json({ flags: s.flags } as never)})
    returning id`;
  if (!held) await sql`update community_posts set comment_count = comment_count + 1, last_activity_at = now() where id = ${postId}`;
  await addPoints(user.id, POINTS.comment);
  const nick = me.nickname ?? "이웃";
  after(async () => {
    await reviewAfterSave("comment", c.id, s.text, held, s.flags);
    if (held) return;
    const preview = s.text.replace(/\s+/g, " ").slice(0, 100);
    const targets = new Set<string>();
    if (post.user_id && post.user_id !== user.id) targets.add(post.user_id);
    if (parentAuthor && parentAuthor !== user.id) targets.add(parentAuthor);
    // 나를 차단한 사람에게는 알리지 않는다
    const blockers = await sql<{ user_id: string }[]>`
      select user_id from community_blocks where blocked_id = ${user.id} and user_id = any(${[...targets]}::uuid[])`;
    for (const b of blockers) targets.delete(b.user_id);
    for (const uid of targets) {
      await notifyCommunity({
        userId: uid,
        kind: "community_reply",
        title: uid === parentAuthor ? `${nick}님이 내 댓글에 답글을 남겼습니다` : `${nick}님이 "${post.title.slice(0, 30)}"에 댓글을 남겼습니다`,
        body: preview,
        url: postUrl(postId, c.id),
        dedupe: `reply:${c.id}`,
        push: true,
      });
    }
  });
  refresh();
  return { ok: held ? "댓글이 검토 후 공개됩니다." : "등록했습니다." };
}

export async function deleteCommentAction(commentId: number) {
  const user = await requireUser();
  const [c] = await sql<{ user_id: string | null; was_visible: boolean }[]>`
    update community_comments m set status = 'deleted'
    from (select id, status = 'visible' as was_visible from community_comments where id = ${commentId}) o
    where m.id = o.id and (m.user_id = ${user.id} or ${user.isAdmin}) and m.status <> 'deleted'
    returning m.user_id, o.was_visible`;
  if (!c) return;
  if (c.was_visible) await recountComments(commentId);
  if (c.user_id === user.id) await addPoints(user.id, -POINTS.comment);
  refresh();
}

/** 좋아요 토글. 결과 개수를 돌려줘 화면을 바로 갱신한다 */
export async function toggleLikeAction(target: "post" | "comment", id: number): Promise<{ liked: boolean; count: number } | { error: string }> {
  const user = await requireMember();
  if (target !== "post" && target !== "comment") return { error: "잘못된 요청" };
  const table = target === "post" ? sql`community_posts` : sql`community_comments`;
  const [row] = await sql<{ user_id: string | null; status: string }[]>`select user_id, status from ${table} where id = ${id}`;
  if (!row || row.status !== "visible") return { error: "좋아요를 누를 수 없습니다." };
  const del = await sql`delete from community_reactions where target_type = ${target} and target_id = ${id} and user_id = ${user.id}`;
  const liked = del.count === 0;
  if (liked) await sql`insert into community_reactions (target_type, target_id, user_id) values (${target}, ${id}, ${user.id}) on conflict do nothing`;
  const [r] = await sql<{ like_count: number }[]>`
    update ${table} set like_count = (select count(*) from community_reactions where target_type = ${target} and target_id = ${id})
    where id = ${id} returning like_count`;
  if (row.user_id && row.user_id !== user.id) await addPoints(row.user_id, liked ? POINTS.likeReceived : -POINTS.likeReceived);
  return { liked, count: r.like_count };
}

export async function reportAction(target: "post" | "comment", id: number, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireMember();
  const reason = str(form.get("reason"));
  if (!isReportReason(reason)) return { error: "신고 사유를 고르세요." };
  const detail = str(form.get("detail")).slice(0, 500) || null;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from community_reports where reporter_id = ${user.id} and created_at > now() - interval '1 day'`;
  if (n >= LIMITS.reportsPerDay) return { error: "오늘은 더 신고할 수 없습니다." };
  const table = target === "post" ? sql`community_posts` : sql`community_comments`;
  const [row] = await sql<{ user_id: string | null }[]>`select user_id from ${table} where id = ${id}`;
  if (!row) return { error: "대상을 찾을 수 없습니다." };
  if (row.user_id === user.id) return { error: "내 글은 신고할 수 없습니다." };
  const ins = await sql`
    insert into community_reports (target_type, target_id, reporter_id, reason, detail) values (${target}, ${id}, ${user.id}, ${reason}, ${detail})
    on conflict do nothing`;
  if (!ins.count) return { ok: "이미 신고했습니다. 운영자가 확인합니다." };
  const { communityAutoHideReports: threshold } = await getSiteSettings();
  const [r] = await sql<{ report_count: number; hidden: boolean }[]>`
    update ${table} set report_count = report_count + 1,
      status = case when status = 'visible' and report_count + 1 >= ${threshold} and not (moderation ? 'by') then 'hidden' else status end,
      moderation = case when status = 'visible' and report_count + 1 >= ${threshold} and not (moderation ? 'by')
                        then moderation || jsonb_build_object('auto_hidden', now()) else moderation end
    where id = ${id} returning report_count, status = 'hidden' as hidden`;
  if (r?.hidden && target === "comment") await recountComments(id);
  if (r?.hidden) {
    // 관리자에게 알림(자동으로 가린 뒤 확인 요청)
    const admins = await sql<{ id: string }[]>`
      select id from users where status = 'active' and (role = 'admin' or lower(email) = any(${env.adminEmails}::text[]))`;
    for (const a of admins) {
      await notifyCommunity({ userId: a.id, kind: "community_mod", title: "신고 누적으로 자동으로 가려진 게시물이 있습니다", body: `신고 ${r.report_count}건 · 확인해 주세요`, url: "/admin/community", dedupe: `mod:${target}:${id}`, push: false });
    }
  }
  return { ok: r?.hidden ? "신고가 누적되어 게시물을 가렸습니다. 운영자가 확인합니다." : "신고했습니다. 운영자가 확인합니다." };
}

export async function voteAction(postId: number, option: number): Promise<{ error?: string }> {
  const user = await requireMember();
  const [p] = await sql<{ n: number; closed: boolean; status: string }[]>`
    select cardinality(pl.options) as n, coalesce(pl.closes_at < now(), false) as closed, p.status
    from community_polls pl join community_posts p on p.id = pl.post_id where pl.post_id = ${postId}`;
  if (!p || p.status !== "visible") return { error: "투표를 찾을 수 없습니다." };
  if (p.closed) return { error: "마감된 투표입니다." };
  if (!Number.isInteger(option) || option < 0 || option >= p.n) return { error: "잘못된 항목" };
  await sql`
    insert into community_poll_votes (post_id, user_id, option) values (${postId}, ${user.id}, ${option})
    on conflict (post_id, user_id) do update set option = excluded.option, created_at = now()`;
  refresh();
  return {};
}

export async function followAction(scope: "sgg" | "complex", id: string, on: boolean) {
  const user = await ensureUser();
  if (scope !== "sgg" && scope !== "complex") return;
  if (scope === "sgg" && !isSgg(id)) return;
  if (scope === "complex" && !/^\d+$/.test(id)) return;
  if (on) await sql`insert into community_follows (user_id, scope, scope_id) values (${user.id}, ${scope}, ${id}) on conflict do nothing`;
  else await sql`delete from community_follows where user_id = ${user.id} and scope = ${scope} and scope_id = ${id}`;
  refresh();
}

export async function saveProfileAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireMember();
  const me = await communityMe(user.id, user.isAdmin);
  const nickname = str(form.get("nickname"));
  const err = nicknameError(nickname);
  if (err) return { error: err };
  if (!me.agreedAt && form.get("agree") !== "on") return { error: "운영 원칙에 동의해야 합니다." };
  // 닉네임은 30일에 한 번만 바꿀 수 있다(사칭·세탁 방지). 처음 정할 때는 제한 없음
  if (me.nickname && me.nickname !== nickname) {
    const [{ recent }] = await sql<{ recent: boolean }[]>`
      select coalesce((settings->>'nicknameChangedAt')::timestamptz > now() - interval '30 days', false) as recent from users where id = ${user.id}`;
    if (recent && !user.isAdmin) return { error: "닉네임은 30일에 한 번만 바꿀 수 있습니다." };
  }
  const settings = {
    communityShowOwner: form.get("show_owner") === "on",
    communityPush: form.get("community_push") === "on",
    ...(me.nickname !== nickname ? { nicknameChangedAt: new Date().toISOString() } : {}),
  };
  try {
    await sql`
      update users set nickname = ${nickname}, community_agreed_at = coalesce(community_agreed_at, now()),
        settings = settings || ${sql.json(settings)}
      where id = ${user.id}`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { error: "이미 쓰고 있는 닉네임입니다." };
    throw e;
  }
  const next = str(form.get("next"));
  if (next.startsWith("/community")) redirect(next);
  refresh();
  return { ok: "저장했습니다." };
}

export async function summaryAction(scope: "complex_faq" | "sgg_week", id: string): Promise<FormState> {
  const user = await requireMember();
  if (scope === "sgg_week" ? !isSgg(id) : !/^\d+$/.test(id)) return { error: "잘못된 요청" };
  try {
    const r = await buildSummary(user.id, scope, id, user.isAdmin);
    refresh();
    return { ok: r.cached ? "최근 12시간 안에 만든 요약입니다." : "요약을 만들었습니다." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** 사용자 차단·해제. 차단한 사용자의 글은 목록에서 빠지고 댓글은 가려지며, 그 사용자의 댓글 알림도 오지 않는다 */
export async function blockUserAction(targetId: string, block: boolean): Promise<FormState> {
  const user = await requireMember();
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) return { error: "잘못된 요청" };
  if (targetId === user.id) return { error: "나를 차단할 수 없습니다." };
  if (block) {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from community_blocks where user_id = ${user.id}`;
    if (n >= LIMITS.blocksMax) return { error: `차단은 ${LIMITS.blocksMax}명까지 할 수 있습니다.` };
    await sql`insert into community_blocks (user_id, blocked_id) select ${user.id}, id from users where id = ${targetId} on conflict do nothing`;
  } else {
    await sql`delete from community_blocks where user_id = ${user.id} and blocked_id = ${targetId}`;
  }
  refresh();
  return { ok: block ? "차단했습니다. 이 사용자의 글과 댓글이 보이지 않습니다." : "차단을 풀었습니다." };
}
