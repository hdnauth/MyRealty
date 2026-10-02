// 인증·권한 정책(순수 함수). proxy·서버 코드·테스트에서 함께 쓴다.

export const SESSION_COOKIE = "mr_session";

/** "이 기기 기억하기": 쿠키·세션 유효기간(접속할 때마다 연장) */
export const REMEMBER_DAYS = 90;
/** 기억하지 않는 기기: 브라우저를 닫으면 쿠키가 사라지고, 서버 세션도 이 시간 뒤 만료 */
export const SHORT_SESSION_HOURS = 12;
/** 기억된 세션의 쿠키를 다시 발급하는 주기(초) */
export const RENEW_AFTER_SEC = 24 * 3600;

export type SignupMode = "open" | "allowlist" | "closed";
export const SIGNUP_MODES: { value: SignupMode; label: string; desc: string }[] = [
  { value: "open", label: "누구나 가입", desc: "이메일 인증만 하면 누구나 가입·로그인할 수 있습니다." },
  { value: "allowlist", label: "허용 목록만", desc: "허용 목록(과 ALLOWED_EMAILS)에 있는 이메일만 새로 가입할 수 있습니다." },
  { value: "closed", label: "가입 중지", desc: "새 가입을 받지 않습니다. 기존 사용자는 계속 로그인할 수 있습니다." },
];

export function parseSignupMode(v: unknown): SignupMode {
  return v === "allowlist" || v === "closed" ? v : "open";
}

export function isAdminEmail(email: string, adminEmails: readonly string[]) {
  return adminEmails.includes(email.toLowerCase());
}

/** DB 역할이 admin 이거나 ADMIN_EMAILS 에 있으면 관리자 */
export function isAdminUser(u: { email: string; role: string }, adminEmails: readonly string[]) {
  return u.role === "admin" || isAdminEmail(u.email, adminEmails);
}

export type LoginDecision =
  | { allow: true; isNew: boolean }
  | { allow: false; reason: "blocked" | "signup_closed" | "not_allowlisted" };

/**
 * 로그인 코드 발송·검증 전 판단.
 * - 정지된 계정은 거부
 * - 기존 사용자는 가입 방식과 무관하게 허용
 * - 관리자 이메일은 항상 허용
 * - 신규는 가입 방식(open/allowlist/closed)에 따른다
 */
export function decideLogin(input: {
  email: string;
  existing: { status: string } | null;
  mode: SignupMode;
  adminEmails: readonly string[];
  allowlisted: boolean;
}): LoginDecision {
  const { email, existing, mode, adminEmails, allowlisted } = input;
  if (existing) return existing.status === "blocked" ? { allow: false, reason: "blocked" } : { allow: true, isNew: false };
  if (isAdminEmail(email, adminEmails)) return { allow: true, isNew: true };
  if (mode === "open") return { allow: true, isNew: true };
  if (mode === "allowlist") return allowlisted ? { allow: true, isNew: true } : { allow: false, reason: "not_allowlisted" };
  return { allow: false, reason: "signup_closed" };
}

/** 세션 만료 시각 */
export function sessionExpiry(remember: boolean, now = Date.now()): Date {
  return new Date(now + (remember ? REMEMBER_DAYS * 86400_000 : SHORT_SESSION_HOURS * 3600_000));
}

/** 기억된 세션 토큰을 다시 발급할 때인가(iat: 초) */
export function shouldRenew(payload: { rem?: unknown; iat?: number }, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return payload.rem === true && typeof payload.iat === "number" && nowSec - payload.iat >= RENEW_AFTER_SEC;
}

/** 로그인 후 이동 경로(오픈 리다이렉트 방지) */
export function safeNext(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return "/";
  return /^\/login(\/|\?|$)/.test(s) ? "/" : s; // 로그인 화면으로 되돌아가는 루프 방지
}

/**
 * 앱 마켓 심사용 계정이면 고정 코드(메일 발송 안 함), 아니면 null.
 * 관리자 이메일에는 절대 쓰지 않는다(고정 코드가 새면 관리 권한까지 넘어가므로).
 */
export function reviewCode(email: string, review: { email?: string; code?: string }, adminEmails: string[]): string | null {
  if (!review.email || !review.code || email !== review.email) return null;
  if (adminEmails.includes(email)) return null;
  return review.code;
}
