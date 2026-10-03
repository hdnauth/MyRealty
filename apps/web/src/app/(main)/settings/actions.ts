"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { normalizeEmail } from "@/lib/auth/otp";
import { cookies } from "next/headers";
import { destroySession, ensureUser, requireUser, SESSION_COOKIE } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { AREA_UNIT_COOKIE, isAreaUnit, parseManwon } from "@/lib/format";
import { DEFAULT_LTV, LTV_OPTIONS } from "@/lib/brief";
import { isViewMode, VIEW_MODE_COOKIE } from "@/lib/view-mode";

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function revokeSessionAction(form: FormData) {
  const user = await requireUser();
  await sql`update sessions set revoked_at = now() where id = ${String(form.get("id"))} and user_id = ${user.id}`;
  refresh();
}

export async function sendTestPushAction(): Promise<{ message: string }> {
  const user = await requireUser();
  const { sendPushToUser } = await import("@/lib/push");
  const r = await sendPushToUser(user.id, { title: "마이리얼티 테스트 알림", body: "푸시 알림이 정상적으로 동작합니다.", url: "/notifications" });
  return { message: r.sent ? `${r.sent}개 기기로 발송했습니다.` : `발송 실패${"reason" in r ? `: ${r.reason}` : ""}` };
}

export async function updateNotificationSettingsAction(form: FormData) {
  const user = await ensureUser();
  const settings = {
    ...user.settings,
    // 게스트에게는 이메일 항목이 없다 — 가입 후 기본값(받기)이 되도록 그대로 둔다
    ...(user.email ? { emailDigest: form.get("emailDigest") === "on" } : {}),
    pushEnabled: form.get("pushEnabled") === "on",
  };
  await sql`update users set settings = ${sql.json(settings)} where id = ${user.id}`;
  refresh();
}

export async function setAreaUnitAction(form: FormData) {
  const unit = form.get("unit");
  if (!isAreaUnit(unit)) return;
  (await cookies()).set(AREA_UNIT_COOKIE, unit, { path: "/", maxAge: 60 * 60 * 24 * 365 * 2, sameSite: "lax" });
  refresh();
}

export async function setViewModeAction(form: FormData) {
  const mode = form.get("mode");
  if (!isViewMode(mode)) return;
  (await cookies()).set(VIEW_MODE_COOKIE, mode, { path: "/", maxAge: 60 * 60 * 24 * 365 * 2, sameSite: "lax" });
  refresh();
}

export type FinanceFormState = { error?: string; saved?: boolean };

/**
 * 내 자금(가용 현금·연소득·LTV): 매수 후보·관심 부동산의 "살 수 있나"를 계산한다. 게스트도 이 기기에 저장한다.
 * 비우면 지운다.
 */
export async function saveFinanceProfileAction(_: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const rawCash = String(form.get("cash") ?? "").trim();
  const rawIncome = String(form.get("income") ?? "").trim();
  const cash = parseManwon(rawCash);
  const income = parseManwon(rawIncome);
  if (rawCash && (cash === null || cash < 0)) return { error: "가용 현금을 읽을 수 없습니다. 예) 3억 5000" };
  if (rawIncome && (income === null || income <= 0)) return { error: "연소득을 읽을 수 없습니다. 예) 8000만" };
  const ltvRaw = Number(form.get("ltv"));
  const ltv = (LTV_OPTIONS as readonly number[]).includes(ltvRaw) ? ltvRaw : DEFAULT_LTV;
  let user;
  try {
    user = await ensureUser();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const rest = { ...user.settings };
  delete rest.finance;
  const settings = cash === null && income === null ? rest : { ...rest, finance: { cash, income, ltv } };
  await sql`update users set settings = ${sql.json(settings)} where id = ${user.id}`;
  refresh();
  return { saved: true };
}

export async function deleteAccountAction(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  if (user.isEnvAdmin) return { error: "ADMIN_EMAILS 로 지정된 관리자 계정은 탈퇴할 수 없습니다." };
  const confirm = String(form.get("confirm") ?? "").trim();
  if (user.email ? normalizeEmail(confirm) !== user.email : confirm !== "삭제") {
    return { error: user.email ? "확인을 위해 이메일 주소를 정확히 입력하세요." : "확인을 위해 '삭제'를 입력하세요." };
  }
  await sql`delete from users where id = ${user.id}`; // 부동산·메모·알림·세션 등은 cascade
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}
