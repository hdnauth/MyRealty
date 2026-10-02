import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "../db";
import { env } from "../env";
import { AppConfigError, MailError } from "../errors";
import { sendMail } from "../mail";
import { getSiteSettings } from "../site-settings";
import { decideLogin, type LoginDecision, reviewCode } from "./policy";

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_PER_IP_HOUR = 30;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function secret(): string {
  if (!env.authSecret) throw new AppConfigError("AUTH_SECRET 환경 변수가 필요합니다.");
  return env.authSecret;
}

function hashCode(email: string, code: string) {
  return createHash("sha256").update(`${secret()}:${email}:${code}`).digest("hex");
}

export async function isAllowlisted(email: string) {
  if (env.allowedEmails.includes(email)) return true;
  const rows = await sql`select 1 from allowed_emails where email = ${email}`;
  return rows.length > 0;
}

/** 이 이메일이 지금 로그인(또는 가입)할 수 있는지 */
export async function loginDecision(email: string): Promise<LoginDecision> {
  const [existing] = await sql<{ status: string }[]>`select status from users where email = ${email}`;
  const { signupMode } = await getSiteSettings();
  return decideLogin({
    email,
    existing: existing ?? null,
    mode: signupMode,
    adminEmails: env.adminEmails,
    allowlisted: !existing && signupMode === "allowlist" ? await isAllowlisted(email) : false,
  });
}

export type RequestResult = { ok: true } | { ok: false; error: string };

/**
 * 로그인할 수 있는 이메일이면 6자리 코드를 발송한다.
 * 거부된 이메일(정지·가입 제한)에도 같은 응답을 준다(계정 존재 여부 노출 방지).
 * DB·메일 오류는 예외로 올려 호출부에서 사용자 문구로 바꾼다.
 */
export async function requestOtp(rawEmail: string, ip: string | null): Promise<RequestResult> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: "올바른 이메일 주소를 입력하세요." };
  secret(); // 설정 누락을 먼저 드러낸다

  const [recent] = await sql<{ last_min: number; last_hour: number }[]>`
    select count(*) filter (where created_at > now() - interval '1 minute')::int as last_min,
           count(*) filter (where created_at > now() - interval '1 hour')::int as last_hour
    from otp_codes where email = ${email}`;
  if (recent.last_min >= 1) return { ok: false, error: "잠시 후(1분) 다시 요청하세요." };
  if (recent.last_hour >= 5) return { ok: false, error: "요청이 너무 많습니다. 1시간 후 다시 시도하세요." };
  if (ip) {
    const [byIp] = await sql<{ n: number }[]>`
      select count(*)::int as n from otp_codes where ip = ${ip} and created_at > now() - interval '1 hour'`;
    if (byIp.n >= MAX_PER_IP_HOUR) return { ok: false, error: "이 네트워크에서 요청이 너무 많습니다. 잠시 후 다시 시도하세요." };
  }

  const decision = await loginDecision(email);
  if (!decision.allow) {
    console.warn(`[auth] 로그인 거부(${decision.reason}): ${email}`);
    // 레이트리밋 계산을 위해 기록은 남긴다(코드는 쓸 수 없는 값).
    await sql`insert into otp_codes (email, code_hash, expires_at, consumed_at, ip)
              values (${email}, 'denied', now(), now(), ${ip})`;
    return { ok: true };
  }

  const fixed = reviewCode(email, env.reviewLogin, env.adminEmails);
  const code = fixed ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [row] = await sql<{ id: number }[]>`
    insert into otp_codes (email, code_hash, expires_at, ip)
    values (${email}, ${hashCode(email, code)}, now() + ${`${CODE_TTL_MIN} minutes`}::interval, ${ip})
    returning id`;
  if (fixed) {
    console.warn(`[auth] 심사용 계정 로그인 코드 요청: ${email}`);
    return { ok: true };
  }
  try {
    await sendMail(
      email,
      `[마이리얼티] 로그인 코드 ${code}`,
      `마이리얼티 로그인 코드: ${code}\n\n${CODE_TTL_MIN}분 안에 입력하세요. 요청하지 않았다면 이 메일을 무시하세요.`,
      `<p>마이리얼티 로그인 코드</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>${CODE_TTL_MIN}분 안에 입력하세요.</p>`,
    );
  } catch (e) {
    // 보내지 못한 코드는 무효화(1분 제한에는 걸리지 않도록 기록 삭제)
    await sql`delete from otp_codes where id = ${row.id}`.catch(() => {});
    throw new MailError("로그인 코드 메일 발송 실패", { cause: e });
  }
  return { ok: true };
}

export type VerifyResult = { ok: true; userId: string; isNew: boolean } | { ok: false; error: string };

export async function verifyOtp(rawEmail: string, rawCode: string): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "6자리 코드를 입력하세요." };

  const [row] = await sql<{ id: number; code_hash: string; attempts: number }[]>`
    select id, code_hash, attempts from otp_codes
    where email = ${email} and consumed_at is null and expires_at > now()
    order by created_at desc limit 1`;
  if (!row) return { ok: false, error: "코드가 만료되었습니다. 다시 요청하세요." };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "시도 횟수를 초과했습니다. 코드를 다시 요청하세요." };

  const expected = Buffer.from(row.code_hash, "hex");
  const actual = Buffer.from(hashCode(email, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await sql`update otp_codes set attempts = attempts + 1 where id = ${row.id}`;
    return { ok: false, error: "코드가 일치하지 않습니다." };
  }
  await sql`update otp_codes set consumed_at = now() where id = ${row.id}`;

  // 코드 발송 이후 정지·가입 정책이 바뀌었을 수 있으니 다시 확인
  const decision = await loginDecision(email);
  if (!decision.allow) {
    return { ok: false, error: decision.reason === "blocked" ? "이용이 정지된 계정입니다. 관리자에게 문의하세요." : "현재 새 가입을 받지 않습니다." };
  }
  const [user] = await sql<{ id: string; is_new: boolean }[]>`
    insert into users (email, last_login_at) values (${email}, now())
    on conflict (email) do update set last_login_at = now()
    returning id, (xmax = 0) as is_new`;
  return { ok: true, userId: user.id, isNew: user.is_new };
}
