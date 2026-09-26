"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestOtp, verifyOtp } from "@/lib/auth/otp";
import { createSession } from "@/lib/auth/session";
import { env } from "@/lib/env";

export type LoginState = {
  step: "email" | "code";
  email?: string;
  error?: string;
  info?: string;
};

export async function requestCodeAction(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const res = await requestOtp(email, ip);
  if (!res.ok) return { step: "email", email, error: res.error };
  return {
    step: "code",
    email: email.trim().toLowerCase(),
    info: env.smtp.host
      ? "이메일로 6자리 코드를 보냈습니다. (허용된 주소만 발송됩니다)"
      : "개발 모드: SMTP 미설정으로 코드가 서버 로그에 출력됩니다.",
  };
}

function safeNext(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function verifyCodeAction(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? prev.email ?? "");
  const code = String(form.get("code") ?? "");
  const res = await verifyOtp(email, code);
  if (!res.ok) return { step: "code", email, error: res.error };
  await createSession(res.userId);
  redirect(safeNext(form.get("next")));
}
