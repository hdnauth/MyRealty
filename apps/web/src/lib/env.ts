import "server-only";

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function emailList(name: string): string[] {
  return (opt(name) ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const env = {
  databaseUrl: opt("DATABASE_URL") ?? "postgresql://myrealty:myrealty@localhost:5432/myrealty",
  authSecret: opt("AUTH_SECRET") ?? (process.env.NODE_ENV === "production" ? undefined : "dev-only-insecure-secret-change-me"),
  /** 관리자 계정(쉼표 구분). 관리 화면 접근, 가입 정책과 무관하게 로그인 가능, 화면에서 해제·정지 불가 */
  adminEmails: emailList("ADMIN_EMAILS"),
  /** 가입 방식이 "허용 목록"일 때 추가로 허용할 이메일 */
  allowedEmails: emailList("ALLOWED_EMAILS"),
  smtp: {
    host: opt("SMTP_HOST"),
    port: Number(opt("SMTP_PORT") ?? 587),
    user: opt("SMTP_USER"),
    password: opt("SMTP_PASSWORD"),
    from: opt("MAIL_FROM") ?? "MyRealty <no-reply@example.com>",
  },
  jusoKey: opt("JUSO_KEY"),
  ncpKeyId: opt("NCP_MAPS_KEY_ID"),
  ncpKey: opt("NCP_MAPS_KEY"),
  anthropicApiKey: opt("ANTHROPIC_API_KEY"),
  anthropicModel: opt("ANTHROPIC_MODEL") ?? "claude-opus-5",
  vapidPublicKey: opt("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
  vapidPrivateKey: opt("VAPID_PRIVATE_KEY"),
  vapidSubject: opt("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  appUrl: opt("APP_URL") ?? "http://localhost:3000",
  isDev: process.env.NODE_ENV !== "production",
};

export function requireAuthSecret(): Uint8Array {
  if (!env.authSecret) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  return new TextEncoder().encode(env.authSecret);
}
