"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { normalizeEmail } from "@/lib/auth/otp";
import { cookies } from "next/headers";
import { destroySession, requireUser, SESSION_COOKIE } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function revokeSessionAction(form: FormData) {
  const user = await requireUser();
  await sql`update sessions set revoked_at = now() where id = ${String(form.get("id"))} and user_id = ${user.id}`;
  refresh();
}

export async function sendTestPushAction(): Promise<{ message: string }> {
  const user = await requireUser();
  const { sendPushToUser } = await import("@/lib/push");
  const r = await sendPushToUser(user.id, { title: "MyRealty 테스트 알림", body: "푸시 알림이 정상적으로 동작합니다.", url: "/notifications" });
  return { message: r.sent ? `${r.sent}개 기기로 발송했습니다.` : `발송 실패${"reason" in r ? `: ${r.reason}` : ""}` };
}

export async function updateNotificationSettingsAction(form: FormData) {
  const user = await requireUser();
  const settings = {
    ...user.settings,
    emailDigest: form.get("emailDigest") === "on",
    pushEnabled: form.get("pushEnabled") === "on",
  };
  await sql`update users set settings = ${sql.json(settings)} where id = ${user.id}`;
  refresh();
}

export async function deleteAccountAction(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  if (user.isEnvAdmin) return { error: "ADMIN_EMAILS 로 지정된 관리자 계정은 탈퇴할 수 없습니다." };
  if (normalizeEmail(String(form.get("confirm") ?? "")) !== user.email) return { error: "확인을 위해 이메일 주소를 정확히 입력하세요." };
  await sql`delete from users where id = ${user.id}`; // 물건·메모·알림·세션 등은 cascade
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
