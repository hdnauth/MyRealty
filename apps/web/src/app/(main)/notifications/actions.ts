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
 * 알림 하나를 읽음으로. 레이아웃(사이드바·상단 배지)은 화면 이동 때 다시 그려지지 않으므로 refresh() 로 함께 갱신한다.
 */
export async function markReadAction(id: number) {
  const user = await requireUser();
  if (!Number.isSafeInteger(id)) return;
  await sql`update notifications set read_at = now() where id = ${id} and user_id = ${user.id} and read_at is null`;
  refresh();
}
