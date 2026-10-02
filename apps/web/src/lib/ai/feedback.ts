/** AI 생성 콘텐츠 신고(Google Play AI 생성 콘텐츠 정책: 앱 안에서 부적절한 AI 출력을 신고할 수 있어야 한다) */
export const AI_REPORT_REASONS = {
  harmful: "부적절·유해한 내용",
  wrong: "사실과 다르거나 잘못된 수치",
  privacy: "개인정보 노출",
  other: "기타",
} as const;
export type AiReportReason = keyof typeof AI_REPORT_REASONS;
export function isAiReportReason(v: unknown): v is AiReportReason {
  return typeof v === "string" && v in AI_REPORT_REASONS;
}

export const AI_SURFACES = ["chat", "report", "community_summary", "community_answer"] as const;
export type AiSurface = (typeof AI_SURFACES)[number];
export function isAiSurface(v: unknown): v is AiSurface {
  return typeof v === "string" && (AI_SURFACES as readonly string[]).includes(v);
}

export const AI_SURFACE_LABEL: Record<AiSurface, string> = {
  chat: "질문하기",
  report: "리포트",
  community_summary: "동네 이야기 요약",
  community_answer: "동네 이야기 AI 답변",
};

/** 검토용 발췌: 공백을 줄이고 앞부분만 */
export function feedbackExcerpt(text: string, max = 2000) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
