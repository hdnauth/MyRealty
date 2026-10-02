// 사이트 설정 타입·기본값·정규화(순수 함수)
import { parseSignupMode, type SignupMode } from "./auth/policy";

export type SiteSettings = {
  /** 새 사용자 가입 방식 */
  signupMode: SignupMode;
  /** 사용자 1인당 월 AI 사용 한도(USD). null 이면 제한 없음(전체 예산만 적용) */
  aiUserMonthlyLimitUsd: number | null;
  /** 모든 화면 상단에 보이는 공지. 빈 문자열이면 숨김 */
  notice: string;
  /** 커뮤니티 열기(끄면 읽기만 가능) */
  communityEnabled: boolean;
  /** 서버 AI(ANTHROPIC_API_KEY)로 새 글·댓글 자동 검토 */
  communityAiModeration: boolean;
  /** 질문 글에 서버 AI 가 데이터 기반 첫 답변을 단다 */
  communityAiAnswer: boolean;
  /** 신고가 이만큼 모이면 자동으로 가린다 */
  communityAutoHideReports: number;
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  signupMode: "open",
  aiUserMonthlyLimitUsd: null,
  notice: "",
  communityEnabled: true,
  communityAiModeration: true,
  communityAiAnswer: true,
  communityAutoHideReports: 3,
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function normalizeSiteSettings(raw: Record<string, unknown>): SiteSettings {
  return {
    signupMode: parseSignupMode(raw.signupMode),
    aiUserMonthlyLimitUsd: num(raw.aiUserMonthlyLimitUsd),
    notice: typeof raw.notice === "string" ? raw.notice.slice(0, 300) : "",
    communityEnabled: bool(raw.communityEnabled, DEFAULT_SITE_SETTINGS.communityEnabled),
    communityAiModeration: bool(raw.communityAiModeration, DEFAULT_SITE_SETTINGS.communityAiModeration),
    communityAiAnswer: bool(raw.communityAiAnswer, DEFAULT_SITE_SETTINGS.communityAiAnswer),
    communityAutoHideReports: Math.min(20, Math.max(1, Math.round(num(raw.communityAutoHideReports) ?? DEFAULT_SITE_SETTINGS.communityAutoHideReports))),
  };
}
