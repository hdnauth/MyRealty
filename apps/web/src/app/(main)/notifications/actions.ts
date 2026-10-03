"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export async function markAllReadAction() {
  const user = await requireUser();
  await sql`update notifications set read_at = now() where user_id = ${user.id} and read_at is null`;
  refresh();
}

/**
 * 알림 하나를 눌렀을 때: 읽음 + 직접 연 시각(opened_at, 관리 화면 열람률). 이미 읽은 알림을 다시 눌러도 opened_at 은 남긴다.
 * 레이아웃(사이드바·상단 배지)은 화면 이동 때 다시 그려지지 않으므로 읽음이 바뀌었으면 refresh() 로 함께 갱신한다.
 */
export async function markReadAction(id: number) {
  const user = await requireUser();
  if (!Number.isSafeInteger(id)) return;
  const [r] = await sql<{ was_unread: boolean }[]>`
    update notifications n set read_at = coalesce(n.read_at, now()), opened_at = coalesce(n.opened_at, now())
    from (select read_at is null as was_unread from notifications where id = ${id} and user_id = ${user.id}) o
    where n.id = ${id} and n.user_id = ${user.id} returning o.was_unread`;
  if (r?.was_unread) refresh();
}
