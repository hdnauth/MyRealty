import type { Metadata } from "next";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { health } from "@/lib/admin";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { ActionForm } from "../action-form";
import { cleanupAction } from "../actions";

export const metadata: Metadata = { title: "시스템" };

export default async function AdminSystem() {
  const h = await health();
  const [jobs, aiByPurpose, aiByUser, quota] = await Promise.all([
    sql<{ job: string; status: string; started_at: string; finished_at: string | null; detail: Record<string, unknown> | null }[]>`
      select distinct on (job) job, status, started_at::text, finished_at::text, detail from job_runs order by job, started_at desc`,
    sql<{ purpose: string; calls: number; cost: number }[]>`
      select purpose, count(*)::int as calls, coalesce(sum(cost_usd), 0)::float8 as cost from ai_usage
      where created_at >= date_trunc('month', now()) group by purpose order by cost desc`,
    sql<{ email: string | null; calls: number; cost: number }[]>`
      select u.email, count(*)::int as calls, coalesce(sum(a.cost_usd), 0)::float8 as cost
      from ai_usage a left join users u on u.id = a.user_id
      where a.created_at >= date_trunc('month', now()) group by u.email order by cost desc limit 10`,
    sql<{ api: string; calls: number }[]>`select api, calls from api_quota where day = current_date order by api`,
  ]);
  const keys = [
    ["세션 서명", "AUTH_SECRET", h.authSecret],
    ["관리자 계정", "ADMIN_EMAILS", env.adminEmails.length > 0],
    ["SMTP 메일(로그인 코드·다이제스트)", "SMTP_HOST", h.smtp],
    ["공공데이터포털(실거래·건축물대장·청약)", "DATA_GO_KR_KEY", "ETL"],
    ["도로명주소 검색", "JUSO_KEY", Boolean(env.jusoKey)],
    ["네이버 지도/지오코딩", "NCP_MAPS_KEY_ID / NCP_MAPS_KEY", Boolean(env.ncpKeyId)],
    ["Claude API", "ANTHROPIC_API_KEY", Boolean(env.anthropicApiKey)],
    ["웹푸시(VAPID)", "NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY", Boolean(env.vapidPublicKey && env.vapidPrivateKey)],
    ["정기 리포트 호출 인증", "CRON_SECRET", Boolean(process.env.CRON_SECRET)],
  ] as const;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="상태 점검" sub="같은 정보(비밀값 제외)를 /api/health 에서 JSON 으로 볼 수 있습니다." />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          <li className="flex items-center justify-between py-2">
            <span>데이터베이스</span>
            {h.db === "ok" ? <Badge tone="ok">연결됨</Badge> : <Badge tone="up">오류 {h.dbError}</Badge>}
          </li>
          <li className="flex items-center justify-between gap-2 py-2">
            <span>
              스키마 마이그레이션
              <span className="block text-xs text-muted">{h.migrations?.applied.join(", ")}</span>
            </span>
            {h.migrations?.pending.length ? (
              <Badge tone="up">미적용 {h.migrations.pending.join(", ")}</Badge>
            ) : (
              <Badge tone="ok">최신</Badge>
            )}
          </li>
        </ul>
        <div className="px-4 pb-4">
          <ActionForm action={cleanupAction} className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="secondary" className="h-8">오래된 로그인 코드·만료 세션 정리</Button>
          </ActionForm>
        </div>
      </Card>

      <Card>
        <CardHeader title="환경 변수 · 외부 API" sub="값은 리포지토리 루트 .env 또는 배포 플랫폼 환경 변수에서 설정합니다." />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {keys.map(([name, envName, ok]) => (
            <li key={envName} className="flex items-center justify-between gap-2 py-2">
              <span>
                {name}
                <span className="block text-xs text-muted">{envName}</span>
              </span>
              <span className={ok === "ETL" ? "text-xs text-muted" : ok ? "text-xs font-medium text-ok" : "text-xs text-up"}>
                {ok === "ETL" ? "ETL에서 사용" : ok ? "설정됨" : "미설정"}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="이번 달 AI 사용(용도별)" sub={`예산 $${process.env.AI_MONTHLY_BUDGET_USD ?? 30}`} />
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {aiByPurpose.map((r) => (
              <li key={r.purpose} className="flex justify-between py-2">
                <span className="font-mono text-xs">{r.purpose}</span>
                <span className="tabular text-muted">{r.calls}회 · ${r.cost.toFixed(2)}</span>
              </li>
            ))}
            {!aiByPurpose.length ? <li className="py-2 text-muted">기록 없음</li> : null}
          </ul>
        </Card>
        <Card>
          <CardHeader title="이번 달 AI 사용(사용자별 상위 10)" />
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {aiByUser.map((r) => (
              <li key={r.email ?? "-"} className="flex justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{r.email ?? "ETL·배치"}</span>
                <span className="tabular shrink-0 text-muted">{r.calls}회 · ${r.cost.toFixed(2)}</span>
              </li>
            ))}
            {!aiByUser.length ? <li className="py-2 text-muted">기록 없음</li> : null}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="데이터 수집(ETL) 최근 실행" sub={`GitHub Actions 또는 uv run myrealty daily · 오늘 API 호출: ${quota.map((q) => `${q.api} ${q.calls}`).join(", ") || "없음"}`} />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {jobs.map((j) => (
            <li key={j.job} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-mono text-xs">{j.job}</span>
                <span className="block truncate text-xs text-muted">{j.detail ? JSON.stringify(j.detail).slice(0, 120) : ""}</span>
              </span>
              <span className={`shrink-0 text-xs ${j.status === "ok" ? "text-ok" : j.status === "error" ? "text-up" : "text-muted"}`}>
                {j.status} · {formatDate(j.started_at)}
              </span>
            </li>
          ))}
          {!jobs.length ? <li className="py-2 text-muted">실행 기록이 없습니다.</li> : null}
        </ul>
      </Card>
    </div>
  );
}
