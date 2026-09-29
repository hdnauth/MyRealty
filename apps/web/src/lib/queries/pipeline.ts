import "server-only";
import { sql } from "../db";
import { lastDoctorRun } from "../keycheck";
import { redactSecrets } from "../redact";

/**
 * 화면이 비어 있을 때 '왜 비었는지'를 한두 줄로: GitHub Actions 키 점검(doctor) 결과와 마지막 수집 기록에서 찾는다.
 * kind: trades(실거래·지역 지표) | macro(금리·물가)
 */
export async function pipelineHints(kind: "trades" | "macro"): Promise<string[]> {
  const job = kind === "trades" ? "rtms" : "macro";
  const [doctor, [last]] = await Promise.all([
    lastDoctorRun().catch(() => null),
    sql<{ status: string; started_at: string; detail: Record<string, unknown> | null }[]>`
      select status, started_at::text, detail from job_runs where job = ${job} order by started_at desc limit 1`,
  ]);
  const out: string[] = [];
  const keys = kind === "trades" ? ["DATA_GO_KR_KEY"] : ["ECOS_KEY", "KOSIS_KEY", "REB_KEY"];
  for (const c of doctor?.detail?.checks ?? []) {
    if (!keys.includes(c.key)) continue;
    if (c.status === "error" || c.status === "missing") out.push(`GitHub Actions 의 ${c.key} 문제: ${c.detail}${c.fix ? ` — ${c.fix}` : ""}`);
  }
  if (!last) {
    out.push("아직 수집이 한 번도 돌지 않았습니다. 매일 05:50 수집을 기다리거나 GitHub › Actions › ETL daily 를 직접 실행하세요.");
  } else if (kind === "trades" && last.detail && typeof last.detail.error === "string") {
    out.push(`마지막 실거래 수집(${last.started_at.slice(0, 16)}) 실패: ${redactSecrets(last.detail.error).slice(0, 200)}`);
  } else if (kind === "macro" && last.detail) {
    const skipped = Object.values(last.detail).filter((v): v is string => typeof v === "string" && v.startsWith("skipped"));
    if (skipped.length && !out.length) {
      out.push(`마지막 수집(${last.started_at.slice(0, 16)}) 때 키가 없어 건너뜀: ${skipped.map((s) => s.replace("skipped: ", "")).join(", ")}. 키를 넣은 뒤에는 다음 수집 때 채워집니다(관심 부동산 '다시 불러오기'로도 바로 받을 수 있습니다).`);
    }
  }
  return out;
}
