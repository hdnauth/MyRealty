"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { isValidEmail, normalizeEmail } from "@/lib/auth/otp";
import { destroySession, requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function addAllowedEmailAction(form: FormData) {
  await requireUser();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!isValidEmail(email)) return;
  await sql`insert into allowed_emails (email, note) values (${email}, 'settings') on conflict do nothing`;
  refresh();
}

export async function removeAllowedEmailAction(form: FormData) {
  const user = await requireUser();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (email === user.email) return; // 자기 자신은 제거 불가
  await sql`delete from allowed_emails where email = ${email}`;
  refresh();
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
