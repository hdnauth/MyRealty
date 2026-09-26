// 사이트 설정 타입·기본값·정규화(순수 함수)
import { parseSignupMode, type SignupMode } from "./auth/policy";

export type SiteSettings = {
  /** 새 사용자 가입 방식 */
  signupMode: SignupMode;
  /** 사용자 1인당 월 AI 사용 한도(USD). null 이면 제한 없음(전체 예산만 적용) */
  aiUserMonthlyLimitUsd: number | null;
  /** 모든 화면 상단에 보이는 공지. 빈 문자열이면 숨김 */
  notice: string;
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  signupMode: "open",
  aiUserMonthlyLimitUsd: null,
  notice: "",
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function normalizeSiteSettings(raw: Record<string, unknown>): SiteSettings {
  return {
    signupMode: parseSignupMode(raw.signupMode),
    aiUserMonthlyLimitUsd: num(raw.aiUserMonthlyLimitUsd),
    notice: typeof raw.notice === "string" ? raw.notice.slice(0, 300) : "",
  };
}
