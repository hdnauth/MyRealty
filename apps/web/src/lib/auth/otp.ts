import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "../db";
import { env } from "../env";
import { sendMail } from "../mail";

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function hashCode(email: string, code: string) {
  return createHash("sha256").update(`${env.authSecret}:${email}:${code}`).digest("hex");
}

export async function isAllowed(email: string) {
  if (env.allowedEmails.includes(email)) return true;
  const rows = await sql`select 1 from allowed_emails where email = ${email}`;
  return rows.length > 0;
}

export type RequestResult = { ok: true } | { ok: false; error: string };

/** 허용된 이메일이면 6자리 코드를 발송한다. 허용되지 않은 이메일에도 같은 응답(계정 존재 노출 방지). */
export async function requestOtp(rawEmail: string, ip: string | null): Promise<RequestResult> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: "올바른 이메일 주소를 입력하세요." };

  const [recent] = await sql<{ last_min: number; last_hour: number }[]>`
    select count(*) filter (where created_at > now() - interval '1 minute')::int as last_min,
           count(*) filter (where created_at > now() - interval '1 hour')::int as last_hour
    from otp_codes where email = ${email}`;
  if (recent.last_min >= 1) return { ok: false, error: "잠시 후(1분) 다시 요청하세요." };
  if (recent.last_hour >= 5) return { ok: false, error: "요청이 너무 많습니다. 1시간 후 다시 시도하세요." };

  if (!(await isAllowed(email))) {
    console.warn(`[auth] 허용되지 않은 이메일 로그인 시도: ${email}`);
    // 레이트리밋 계산을 위해 기록은 남긴다(코드는 쓸 수 없는 값).
    await sql`insert into otp_codes (email, code_hash, expires_at, consumed_at, ip)
              values (${email}, 'denied', now(), now(), ${ip})`;
    return { ok: true };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await sql`insert into otp_codes (email, code_hash, expires_at, ip)
            values (${email}, ${hashCode(email, code)}, now() + ${`${CODE_TTL_MIN} minutes`}::interval, ${ip})`;
  await sendMail(
    email,
    `[MyRealty] 로그인 코드 ${code}`,
    `MyRealty 로그인 코드: ${code}\n\n${CODE_TTL_MIN}분 안에 입력하세요. 요청하지 않았다면 이 메일을 무시하세요.`,
    `<p>MyRealty 로그인 코드</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>${CODE_TTL_MIN}분 안에 입력하세요.</p>`,
  );
  return { ok: true };
}

export type VerifyResult = { ok: true; userId: string } | { ok: false; error: string };

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
  const [user] = await sql<{ id: string }[]>`
    insert into users (email, last_login_at) values (${email}, now())
    on conflict (email) do update set last_login_at = now()
    returning id`;
  return { ok: true, userId: user.id };
}
