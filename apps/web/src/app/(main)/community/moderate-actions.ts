"use server";

import { refresh } from "next/cache";
import { audit } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { addPoints, hiddenPenalty, notifyCommunity, postUrl, recountComments } from "@/lib/community/moderation";

/** 운영자: 글·댓글 공개/가리기. 처리하면 열린 신고도 함께 정리하고, 이후 AI 판정이 상태를 바꾸지 않게 by 를 남긴다 */
export async function moderateAction(target: "post" | "comment", id: number, op: "hide" | "restore") {
  const admin = await requireAdmin();
  if ((target !== "post" && target !== "comment") || (op !== "hide" && op !== "restore")) return;
  const table = target === "post" ? sql`community_posts` : sql`community_comments`;
  const status = op === "hide" ? "hidden" : "visible";
  const [row] = await sql<{ user_id: string | null; prev: string; post_id: number }[]>`
    update ${table} t set status = ${status},
      moderation = t.moderation || ${sql.json({ by: admin.email, at: new Date().toISOString(), op })}
    from (select id, status as prev from ${table} where id = ${id}) o
    where t.id = o.id and t.status <> 'deleted'
    returning t.user_id, o.prev, ${target === "post" ? sql`t.id` : sql`t.post_id`} as post_id`;
  if (!row) return;
  await sql`
    update community_reports set status = ${op === "hide" ? "actioned" : "dismissed"}, resolved_at = now(), resolved_by = ${admin.id}
    where target_type = ${target} and target_id = ${id} and status = 'open'`;
  if (target === "comment") await recountComments(id);
  // 가리면 감점, 가린 것을 되돌리면 복구
  if (op === "hide" && row.prev !== "hidden") await addPoints(row.user_id, hiddenPenalty);
  if (op === "restore" && row.prev === "hidden") await addPoints(row.user_id, -hiddenPenalty);
  if (row.user_id) {
    await notifyCommunity({
      userId: row.user_id,
      kind: "community_mod",
      title: op === "hide" ? "운영 원칙 위반으로 게시물이 가려졌습니다" : "검토가 끝나 게시물이 공개되었습니다",
      body: op === "hide" ? "운영 원칙을 확인해 주세요. 반복되면 작성이 제한될 수 있습니다." : "",
      url: op === "hide" ? "/community/rules" : postUrl(row.post_id),
      dedupe: `mod:${target}:${id}:${op}:${Date.now()}`,
      push: false,
    });
  }
  await audit(admin, `community.${target}.${op}`, `${target}:${id}`);
  refresh();
}

/** 신고 기각(게시물은 그대로) */
export async function dismissReportsAction(target: "post" | "comment", id: number) {
  const admin = await requireAdmin();
  const table = target === "post" ? sql`community_posts` : sql`community_comments`;
  await sql`
    update community_reports set status = 'dismissed', resolved_at = now(), resolved_by = ${admin.id}
    where target_type = ${target} and target_id = ${id} and status = 'open'`;
  // 신고 누적으로 자동으로 가려졌던 것이면 되돌린다
  await sql`
    update ${table} set status = 'visible', moderation = moderation || ${sql.json({ by: admin.email, at: new Date().toISOString(), op: "dismiss" })}
    where id = ${id} and status = 'hidden' and moderation ? 'auto_hidden'`;
  if (target === "comment") await recountComments(id);
  await audit(admin, `community.${target}.dismiss`, `${target}:${id}`);
  refresh();
}

/** 작성 제한(일 단위, 0 이면 해제) */
export async function muteUserAction(userId: string, days: number) {
  const admin = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/.test(userId) || !Number.isInteger(days) || days < 0 || days > 3650) return;
  await sql`update users set community_muted_until = ${days ? new Date(Date.now() + days * 86400_000) : null} where id = ${userId}`;
  if (days) {
    await notifyCommunity({
      userId,
      kind: "community_mod",
      title: `운영 원칙 위반으로 ${days}일 동안 글·댓글 작성이 제한되었습니다`,
      body: "읽기와 좋아요는 계속 이용할 수 있습니다.",
      url: "/community/rules",
      dedupe: `mute:${userId}:${Date.now()}`,
      push: false,
    });
  }
  await audit(admin, days ? "community.mute" : "community.unmute", userId, { days });
  refresh();
}
