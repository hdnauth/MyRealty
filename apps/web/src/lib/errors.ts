// 서버 오류를 사용자에게 보여줄 문구로 분류한다(내부 메시지·스택은 노출하지 않음).

export type ErrorKind = "config" | "db_connect" | "db_schema" | "mail" | "unknown";

export class AppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppConfigError";
  }
}

export class MailError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MailError";
  }
}

const DB_CONNECT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "28P01", // invalid_password
  "28000", // invalid_authorization_specification
  "3D000", // invalid_catalog_name (DB 없음)
  "53300", // too_many_connections
  "57P03", // cannot_connect_now
  "08006",
  "08001",
  "XX000", // Supabase 풀러 "Tenant or user not found" 등
]);
const DB_SCHEMA_CODES = new Set(["42P01", "42703", "42883"]); // 테이블·컬럼·함수 없음

function codeOf(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  return undefined;
}

export function classifyError(e: unknown): ErrorKind {
  if (e instanceof AppConfigError) return "config";
  if (e instanceof MailError) return "mail";
  const code = codeOf(e) ?? codeOf((e as { cause?: unknown } | null)?.cause);
  if (code && DB_SCHEMA_CODES.has(code)) return "db_schema";
  if (code && DB_CONNECT_CODES.has(code)) return "db_connect";
  if (e instanceof Error && /AUTH_SECRET/.test(e.message)) return "config";
  return "unknown";
}

export function userMessage(kind: ErrorKind, ref: string): string {
  switch (kind) {
    case "config":
      return `서버 설정이 완료되지 않았습니다(AUTH_SECRET 등 환경 변수 확인). 관리자에게 문의하세요. [${ref}]`;
    case "db_connect":
      return `데이터베이스에 연결할 수 없습니다(DATABASE_URL 확인). 잠시 후 다시 시도하세요. [${ref}]`;
    case "db_schema":
      return `데이터베이스 스키마가 최신이 아닙니다. 관리자가 "uv run myrealty migrate" 를 실행해야 합니다. [${ref}]`;
    case "mail":
      return `로그인 코드 메일을 보내지 못했습니다(SMTP 설정 확인). 잠시 후 다시 시도하세요. [${ref}]`;
    default:
      return `일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도하세요. [${ref}]`;
  }
}

/** 오류를 로그에 남기고 사용자용 문구를 돌려준다. ref 로 서버 로그와 대조할 수 있다. */
export function reportError(scope: string, e: unknown): string {
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  const kind = classifyError(e);
  console.error(`[${scope}] ref=${ref} kind=${kind}`, e);
  return userMessage(kind, ref);
}
