"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { audit, envAdmin } from "@/lib/admin";
import { isValidEmail, normalizeEmail } from "@/lib/auth/otp";
import { parseSignupMode } from "@/lib/auth/policy";
import { requireAdmin } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { saveSiteSettings } from "@/lib/site-settings";

export type AdminActionState = { ok?: string; error?: string };

async function targetUser(id: string) {
  const [u] = await sql<{ id: string; email: string; role: string; status: string }[]>`
    select id, email, role, status from users where id = ${id}`;
  return u ?? null;
}

/** 자기 자신·ADMIN_EMAILS 관리자는 정지·강등·삭제할 수 없다(관리자 잠김 방지). */
function protectedReason(adminId: string, t: { id: string; email: string }) {
  if (t.id === adminId) return "자기 계정에는 적용할 수 없습니다.";
  if (envAdmin(t.email)) return "ADMIN_EMAILS 로 지정된 관리자는 화면에서 변경할 수 없습니다.";
  return null;
}

export async function setUserStatusAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const t = await targetUser(String(form.get("id")));
  if (!t) return { error: "사용자를 찾을 수 없습니다." };
  const status = form.get("status") === "blocked" ? "blocked" : "active";
  const blocked = protectedReason(admin.id, t);
  if (blocked && status === "blocked") return { error: blocked };
  await sql.begin(async (tx) => {
    await tx`update users set status = ${status}, blocked_at = ${status === "blocked" ? new Date() : null} where id = ${t.id}`;
    if (status === "blocked") await tx`update sessions set revoked_at = now() where user_id = ${t.id} and revoked_at is null`;
  });
  await audit(admin, status === "blocked" ? "user.block" : "user.unblock", t.email);
  refresh();
  return { ok: status === "blocked" ? "이용을 정지하고 모든 기기에서 로그아웃시켰습니다." : "정지를 해제했습니다." };
}

export async function setUserRoleAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const t = await targetUser(String(form.get("id")));
  if (!t) return { error: "사용자를 찾을 수 없습니다." };
  const role = form.get("role") === "admin" ? "admin" : "user";
  if (role === "user") {
    const reason = protectedReason(admin.id, t);
    if (reason) return { error: reason };
  }
  await sql`update users set role = ${role} where id = ${t.id}`;
  await audit(admin, role === "admin" ? "user.grant_admin" : "user.revoke_admin", t.email);
  refresh();
  return { ok: role === "admin" ? "관리자 권한을 부여했습니다." : "관리자 권한을 해제했습니다." };
}

export async function revokeUserSessionsAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const t = await targetUser(String(form.get("id")));
  if (!t) return { error: "사용자를 찾을 수 없습니다." };
  // 자기 자신이면 현재 기기는 유지
  const r = await sql`update sessions set revoked_at = now()
                      where user_id = ${t.id} and revoked_at is null and id <> ${admin.sessionId}`;
  await audit(admin, "user.revoke_sessions", t.email, { count: r.count });
  refresh();
  return { ok: `${r.count}개 기기에서 로그아웃시켰습니다.` };
}

export async function revokeSessionAction(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("id"));
  if (id === admin.sessionId) return;
  const [s] = await sql<{ email: string }[]>`
    update sessions s set revoked_at = now() from users u
    where s.id = ${id} and u.id = s.user_id and s.revoked_at is null returning u.email`;
  if (s) await audit(admin, "session.revoke", s.email, { session: id });
  refresh();
}

export async function updateUserProfileAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const t = await targetUser(String(form.get("id")));
  if (!t) return { error: "사용자를 찾을 수 없습니다." };
  const name = String(form.get("displayName") ?? "").trim().slice(0, 50) || null;
  const note = String(form.get("note") ?? "").trim().slice(0, 1000) || null;
  await sql`update users set display_name = ${name}, admin_note = ${note} where id = ${t.id}`;
  await audit(admin, "user.update_profile", t.email);
  refresh();
  return { ok: "저장했습니다." };
}

export async function deleteUserAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const t = await targetUser(String(form.get("id")));
  if (!t) return { error: "사용자를 찾을 수 없습니다." };
  const reason = protectedReason(admin.id, t);
  if (reason) return { error: reason };
  if (normalizeEmail(String(form.get("confirm") ?? "")) !== t.email) return { error: "확인을 위해 이메일 주소를 정확히 입력하세요." };
  const [{ items }] = await sql<{ items: number }[]>`select count(*)::int as items from watch_items where user_id = ${t.id}`;
  await sql`delete from users where id = ${t.id}`; // 부동산·메모·알림·세션 등은 cascade
  await audit(admin, "user.delete", t.email, { items });
  redirect("/admin/users");
}

export async function saveSiteSettingsAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const limitRaw = String(form.get("aiUserMonthlyLimitUsd") ?? "").trim();
  const limit = limitRaw === "" ? null : Number(limitRaw);
  if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return { error: "AI 한도는 0 이상의 숫자이거나 비워 두세요." };
  const patch = {
    signupMode: parseSignupMode(form.get("signupMode")),
    aiUserMonthlyLimitUsd: limit,
    notice: String(form.get("notice") ?? "").trim().slice(0, 300),
    communityEnabled: form.get("communityEnabled") === "on",
    communityAiModeration: form.get("communityAiModeration") === "on",
    communityAiAnswer: form.get("communityAiAnswer") === "on",
    communityAutoHideReports: Math.min(20, Math.max(1, Math.round(Number(form.get("communityAutoHideReports")) || 3))),
  };
  await saveSiteSettings(patch, admin.id);
  await audit(admin, "site.settings", null, patch);
  refresh();
  return { ok: "사이트 설정을 저장했습니다." };
}

export async function addAllowedEmailAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const emails = String(form.get("emails") ?? "")
    .split(/[,;\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);
  const bad = emails.filter((e) => !isValidEmail(e));
  if (!emails.length || bad.length) return { error: bad.length ? `올바르지 않은 이메일: ${bad.join(", ")}` : "이메일을 입력하세요." };
  for (const e of emails) await sql`insert into allowed_emails (email, note) values (${e}, ${`admin:${admin.email}`}) on conflict do nothing`;
  await audit(admin, "allowlist.add", emails.join(","));
  refresh();
  return { ok: `${emails.length}개를 추가했습니다.` };
}

export async function removeAllowedEmailAction(form: FormData) {
  const admin = await requireAdmin();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  await sql`delete from allowed_emails where email = ${email}`;
  await audit(admin, "allowlist.remove", email);
  refresh();
}

export async function cleanupAction(): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const otp = await sql`delete from otp_codes where created_at < now() - interval '1 day'`;
  const ses = await sql`delete from sessions where (revoked_at is not null and revoked_at < now() - interval '30 days')
                                                or expires_at < now() - interval '30 days'`;
  await audit(admin, "system.cleanup", null, { otp: otp.count, sessions: ses.count });
  refresh();
  return { ok: `오래된 로그인 코드 ${otp.count}건, 만료 세션 ${ses.count}건을 정리했습니다.` };
}

// ───────── 수집 지역 ─────────

const SGG = /^\d{5}$/;

/** 대기 중인 지역 요청 켜기: 수집 대상을 켜고 그 시군구의 대기 요청을 모두 enabled 로 */
export async function enableRegionAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const sgg = String(form.get("sgg") ?? "");
  if (!SGG.test(sgg)) return { error: "시군구 코드가 올바르지 않습니다." };
  const [req] = await sql<{ name: string | null }[]>`select name from region_requests where sgg_cd = ${sgg} order by created_at limit 1`;
  const name = req?.name ?? null;
  await sql.begin(async (tx) => {
    await tx`insert into collect_targets (sgg_cd, name) values (${sgg}, ${name})
             on conflict (sgg_cd) do update set enabled = true, name = coalesce(collect_targets.name, excluded.name)`;
    await tx`update region_requests set status = 'enabled' where sgg_cd = ${sgg} and status = 'pending'`;
  });
  await audit(admin, "region.enable", name ?? sgg, { sgg });
  refresh();
  return { ok: `${name ?? sgg} 수집을 켰습니다. 다음 매일 수집부터 채워집니다.` };
}

/** 대기 중인 지역 요청 거절(수집하지 않음) */
export async function rejectRegionAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const sgg = String(form.get("sgg") ?? "");
  if (!SGG.test(sgg)) return { error: "시군구 코드가 올바르지 않습니다." };
  const r = await sql`update region_requests set status = 'rejected' where sgg_cd = ${sgg} and status = 'pending'`;
  await audit(admin, "region.reject", sgg, { count: r.count });
  refresh();
  return { ok: `대기 요청 ${r.count}건을 거절했습니다.` };
}

/**
 * 수집 대상 켜기/끄기. 끄면 매일 수집에서 빠지고 모은 실거래는 그대로 남는다.
 * 관심 부동산이 있는 지역을 끄면 그 사용자들의 새 거래·알림이 멈추므로 확인 문구로 알린다(화면).
 */
export async function setTargetEnabledAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const sgg = String(form.get("sgg") ?? "");
  if (!SGG.test(sgg)) return { error: "시군구 코드가 올바르지 않습니다." };
  const enabled = form.get("enabled") === "1";
  const [t] = await sql<{ name: string | null }[]>`update collect_targets set enabled = ${enabled} where sgg_cd = ${sgg} returning name`;
  if (!t) return { error: "수집 대상을 찾을 수 없습니다." };
  await audit(admin, enabled ? "region.target_on" : "region.target_off", t.name ?? sgg, { sgg });
  refresh();
  return { ok: enabled ? `${t.name ?? sgg} 수집을 켰습니다.` : `${t.name ?? sgg} 수집을 껐습니다(모은 데이터는 남습니다).` };
}
