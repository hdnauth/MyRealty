/**
 * 관심 부동산 개별 수집 단계(서버·브라우저 공용). ETL services/etl/src/myrealty_etl/jobs/item_job.py 의 STEPS 와 같은 키·순서.
 */
export const COLLECT_STEPS = [
  { key: "trades", label: "최근 1년 실거래" },
  { key: "attrs", label: "건축물대장·토지·공시가격" },
  { key: "location", label: "주변 시설·입지 점수" },
  { key: "valuation", label: "추정 시세" },
  { key: "news", label: "관련 뉴스" },
  { key: "history", label: "과거 실거래(3년)" },
] as const;

export type CollectStepKey = (typeof COLLECT_STEPS)[number]["key"];
export type CollectStepState = {
  status: "running" | "done" | "skipped" | "error";
  detail?: Record<string, unknown>;
  started_at?: string;
  finished_at?: string;
};
export type CollectRun = {
  id: number;
  status: "queued" | "running" | "done" | "error";
  runner: string | null;
  steps: Partial<Record<CollectStepKey, CollectStepState>>;
  error: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** 최근(자동 요청 대기 시간 안)에 요청됐는지 */
  recent?: boolean;
};

export const isActive = (run: CollectRun | null | undefined) => run?.status === "queued" || run?.status === "running";

/** 끝난 단계 수(진행 막대·새로 그리기 판단) */
export function finishedSteps(run: CollectRun | null | undefined): number {
  if (!run) return 0;
  return COLLECT_STEPS.filter((s) => {
    const st = run.steps[s.key]?.status;
    return st === "done" || st === "skipped" || st === "error";
  }).length;
}

/** 단계 결과 한 줄(건너뜀·실패 사유) */
export function stepNote(st: CollectStepState | undefined): string | null {
  if (!st) return null;
  const d = st.detail ?? {};
  if (st.status === "skipped") return typeof d.skipped === "string" ? d.skipped : "건너뜀";
  if (st.status === "error") return typeof d.error === "string" && d.error.includes("한도") ? "오늘 호출 한도 초과" : "불러오지 못함";
  return null;
}
