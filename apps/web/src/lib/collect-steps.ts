import { redactSecrets } from "./redact";

/**
 * 관심 부동산 개별 수집 단계(서버·브라우저 공용). ETL services/etl/src/myrealty_etl/jobs/item_job.py 의 STEPS 와 같은 키·순서.
 */
export const COLLECT_STEPS = [
  { key: "trades", label: "최근 1년 실거래" },
  { key: "attrs", label: "건축물대장·토지·공시가격" },
  { key: "location", label: "주변 시설·입지 점수" },
  { key: "valuation", label: "추정 시세" },
  { key: "market", label: "금리·물가·지역 지표" },
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
  if (st.status === "error") return errorNote(typeof d.error === "string" ? d.error : "");
  return null;
}

/** 수집 오류 → 한 줄 사유. ETL 이 사람이 읽을 문장을 남기면 그대로, 예전 형식(예외 repr)은 상태 코드로 풀어 쓴다 */
export function errorNote(raw: string): string {
  if (!raw) return "불러오지 못함";
  const err = redactSecrets(raw);
  if (err.includes("한도")) return "오늘 호출 한도 초과";
  if (!/^[A-Za-z]+(Error|Exception)\(/.test(err)) return err.length > 160 ? `${err.slice(0, 160)}…` : err;
  const api = /data\.go\.kr|odcloud/.test(err) ? "공공데이터포털" : /vworld/.test(err) ? "브이월드" : /naver/.test(err) ? "네이버" : "외부 API";
  if (/'40[13] /.test(err)) return `${api}에서 요청을 거부했습니다(키·활용신청 확인 — 관리 › 시스템 › 키 점검)`;
  if (/disconnect|timed? ?out|Connect/i.test(err)) return `${api} 연결 실패(해외 접속 차단일 수 있음)`;
  return "불러오지 못함";
}
