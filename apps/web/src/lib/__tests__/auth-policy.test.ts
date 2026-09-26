import { describe, expect, it } from "vitest";
import {
  decideLogin,
  isAdminUser,
  parseSignupMode,
  REMEMBER_DAYS,
  RENEW_AFTER_SEC,
  safeNext,
  sessionExpiry,
  SHORT_SESSION_HOURS,
  shouldRenew,
} from "../auth/policy";
import { shouldPrepare } from "../db-config";
import { AppConfigError, classifyError, MailError, userMessage } from "../errors";
import { normalizeSiteSettings } from "../site-config";

const admins = ["boss@example.com"];

describe("decideLogin", () => {
  const base = { email: "new@example.com", existing: null, adminEmails: admins, allowlisted: false };

  it("누구나 가입(open)이면 신규 이메일 허용", () => {
    expect(decideLogin({ ...base, mode: "open" })).toEqual({ allow: true, isNew: true });
  });
  it("허용 목록 모드는 목록에 있을 때만 신규 허용", () => {
    expect(decideLogin({ ...base, mode: "allowlist" })).toEqual({ allow: false, reason: "not_allowlisted" });
    expect(decideLogin({ ...base, mode: "allowlist", allowlisted: true })).toEqual({ allow: true, isNew: true });
  });
  it("가입 중지면 신규 거부, 기존 사용자는 허용", () => {
    expect(decideLogin({ ...base, mode: "closed" })).toEqual({ allow: false, reason: "signup_closed" });
    expect(decideLogin({ ...base, mode: "closed", existing: { status: "active" } })).toEqual({ allow: true, isNew: false });
  });
  it("관리자 이메일은 가입 방식과 무관하게 허용", () => {
    expect(decideLogin({ ...base, email: "boss@example.com", mode: "closed" })).toEqual({ allow: true, isNew: true });
  });
  it("정지된 계정은 항상 거부(관리자 이메일이어도 DB 상태 우선)", () => {
    expect(decideLogin({ ...base, mode: "open", existing: { status: "blocked" } })).toEqual({ allow: false, reason: "blocked" });
  });
});

describe("권한·세션", () => {
  it("DB 역할 또는 ADMIN_EMAILS 로 관리자 판정", () => {
    expect(isAdminUser({ email: "a@x.com", role: "admin" }, admins)).toBe(true);
    expect(isAdminUser({ email: "BOSS@example.com", role: "user" }, admins)).toBe(true);
    expect(isAdminUser({ email: "a@x.com", role: "user" }, admins)).toBe(false);
  });
  it("가입 방식 파싱 기본값은 open", () => {
    expect(parseSignupMode("allowlist")).toBe("allowlist");
    expect(parseSignupMode("closed")).toBe("closed");
    expect(parseSignupMode("weird")).toBe("open");
    expect(parseSignupMode(undefined)).toBe("open");
  });
  it("기억하기 여부에 따른 만료", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(sessionExpiry(true, now).getTime() - now).toBe(REMEMBER_DAYS * 86400_000);
    expect(sessionExpiry(false, now).getTime() - now).toBe(SHORT_SESSION_HOURS * 3600_000);
  });
  it("기억된 토큰만 하루 지나면 재발급", () => {
    const now = 1_800_000_000;
    expect(shouldRenew({ rem: true, iat: now - RENEW_AFTER_SEC }, now)).toBe(true);
    expect(shouldRenew({ rem: true, iat: now - 60 }, now)).toBe(false);
    expect(shouldRenew({ rem: false, iat: now - RENEW_AFTER_SEC * 5 }, now)).toBe(false);
    expect(shouldRenew({ iat: now - RENEW_AFTER_SEC * 5 }, now)).toBe(false);
  });
  it("로그인 후 이동 경로는 내부 경로만", () => {
    expect(safeNext("/items/1")).toBe("/items/1");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("/login?next=/x")).toBe("/");
    expect(safeNext("/loginhelp")).toBe("/loginhelp");
  });
});

describe("오류 분류", () => {
  it("DB 연결·스키마·설정·메일 오류를 구분", () => {
    expect(classifyError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("db_connect");
    expect(classifyError(Object.assign(new Error("x"), { code: "28P01" }))).toBe("db_connect");
    expect(classifyError(Object.assign(new Error("x"), { code: "42P01" }))).toBe("db_schema");
    expect(classifyError(new AppConfigError("AUTH_SECRET"))).toBe("config");
    expect(classifyError(new Error("AUTH_SECRET 환경 변수가 필요합니다."))).toBe("config");
    expect(classifyError(new MailError("smtp", { cause: new Error("auth") }))).toBe("mail");
    expect(classifyError(new Error("boom"))).toBe("unknown");
    expect(classifyError(null)).toBe("unknown");
  });
  it("사용자 문구에 참조 번호 포함", () => {
    expect(userMessage("db_schema", "AB12CD")).toContain("[AB12CD]");
    expect(userMessage("db_schema", "AB12CD")).toContain("migrate");
  });
});

describe("DB 풀러 감지", () => {
  it("6543 포트·pgbouncer·pooler 호스트면 prepare 끔", () => {
    expect(shouldPrepare("postgresql://u:p@aws-0-ap.pooler.supabase.com:6543/postgres", undefined)).toBe(false);
    expect(shouldPrepare("postgresql://u:p@host:5432/db?pgbouncer=true", undefined)).toBe(false);
    expect(shouldPrepare("postgresql://u:p@localhost:5432/db", undefined)).toBe(true);
    expect(shouldPrepare("postgresql://u:p@localhost:5432/db", "false")).toBe(false);
    expect(shouldPrepare("postgresql://u:p@x.pooler.supabase.com:6543/db", "true")).toBe(true);
  });
});

describe("사이트 설정 정규화", () => {
  it("잘못된 값은 기본값으로", () => {
    expect(normalizeSiteSettings({})).toEqual({ signupMode: "open", aiUserMonthlyLimitUsd: null, notice: "" });
    expect(normalizeSiteSettings({ signupMode: "closed", aiUserMonthlyLimitUsd: 5, notice: "점검" })).toEqual({
      signupMode: "closed",
      aiUserMonthlyLimitUsd: 5,
      notice: "점검",
    });
    expect(normalizeSiteSettings({ aiUserMonthlyLimitUsd: -1 }).aiUserMonthlyLimitUsd).toBeNull();
    expect(normalizeSiteSettings({ aiUserMonthlyLimitUsd: "abc" }).aiUserMonthlyLimitUsd).toBeNull();
  });
});
