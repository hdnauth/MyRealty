"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestOtp, verifyOtp } from "@/lib/auth/otp";
import { safeNext } from "@/lib/auth/policy";
import { clientIp, createSession, readToken, SESSION_COOKIE } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { getSiteSettings } from "@/lib/site-settings";

export type LoginState = {
  step: "email" | "code";
  email?: string;
  remember?: boolean;
  error?: string;
  info?: string;
};

export async function requestCodeAction(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const remember = form.get("remember") === "on";
  try {
    const res = await requestOtp(email, await clientIp());
    if (!res.ok) return { step: "email", email, remember, error: res.error };
    const { signupMode } = await getSiteSettings();
    const info = !env.smtp.host
      ? env.isDev
        ? "개발 모드: SMTP 미설정으로 코드가 서버 로그에 출력됩니다."
        : "메일 발송(SMTP_HOST)이 설정되지 않아 코드가 메일 대신 서버 로그에만 기록됩니다. 관리자에게 문의하세요."
      : signupMode === "open"
        ? "이메일로 6자리 코드를 보냈습니다. 메일이 없으면 스팸함을 확인하세요."
        : "이메일로 6자리 코드를 보냈습니다. (가입이 허용된 주소에만 발송됩니다)";
    return { step: "code", email, remember, info };
  } catch (e) {
    return { step: "email", email, remember, error: reportError("auth.request", e) };
  }
}

export async function verifyCodeAction(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? prev.email ?? "");
  const code = String(form.get("code") ?? "");
  const remember = form.get("remember") === "on";
  try {
    // 이 기기의 게스트(이메일 없는 계정)가 있으면 그 데이터를 이어받는다
    const tok = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
    const [guest] = tok ? await sql<{ id: string }[]>`select id from users where id = ${tok.uid} and email is null` : [];
    const res = await verifyOtp(email, code, guest?.id ?? null);
    if (!res.ok) return { step: "code", email, remember, error: res.error };
    if (tok) await sql`update sessions set revoked_at = now() where id = ${tok.sid} and revoked_at is null`;
    await createSession(res.userId, remember);
  } catch (e) {
    return { step: "code", email, remember, error: reportError("auth.verify", e) };
  }
  // redirect 는 try 밖에서(내부적으로 예외를 던진다)
  redirect(safeNext(form.get("next")));
}
