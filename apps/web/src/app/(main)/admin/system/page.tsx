import { redactSecrets } from "@/lib/redact";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, LinkButton } from "@/components/ui";
import { health } from "@/lib/admin";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { lastDoctorRun, runKeyChecks } from "@/lib/keycheck";
import { ActionForm } from "../action-form";
import { cleanupAction } from "../actions";
import { KeyTable } from "./key-table";

export const metadata: Metadata = { title: "시스템" };

export default async function AdminSystem(props: PageProps<"/admin/system">) {
  const live = (await props.searchParams).check === "1";
  const hd = await headers();
  const host = hd.get("x-forwarded-host") ?? hd.get("host");
  const origin = host ? `${hd.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}` : null;
  const [h, webKeys, doctor] = await Promise.all([health(), runKeyChecks(live, origin), lastDoctorRun().catch(() => null)]);
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="상태 점검" sub="같은 정보(비밀값 제외)를 /api/health 에서 JSON 으로 볼 수 있습니다." />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          <li className="flex items-center justify-between py-2">
            <span>데이터베이스</span>
            {h.db === "ok" ? <Badge tone="ok">연결됨</Badge> : <Badge tone="up">오류 {h.dbError}</Badge>}
          </li>
          {h.dbRttMs !== undefined ? (
            <li className="flex items-center justify-between gap-2 py-2">
              <span>
                DB 응답 속도
                <span className="block text-xs text-muted">
                  웹 서버 지역 {h.region ?? "알 수 없음(로컬·자체 서버)"} · prepared statement {h.prepare ? "사용(쿼리당 왕복 1회)" : "끔(쿼리당 왕복 2회)"}
                </span>
                {h.dbRttMs > 30 ? (
                  <span className="block text-xs text-up">
                    DB 가 웹 서버와 멀리 있습니다. 화면 하나에 DB 왕복이 5~10번 있어 이 값의 5~10배만큼 느려집니다. 배포 가이드 &quot;속도&quot; 항목대로 지역을 맞추세요.
                  </span>
                ) : null}
              </span>
              <Badge tone={h.dbRttMs > 30 ? "up" : h.dbRttMs > 10 ? "warn" : "ok"}>왕복 {h.dbRttMs}ms</Badge>
            </li>
          ) : null}
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
        <CardHeader
          title="키 점검 · 웹(Vercel)과 GitHub Actions(ETL)"
          sub={
            <>
              {live ? "각 키로 실제 요청을 보내 확인했습니다." : "지금은 설정 여부만 보입니다. 실제 호출로 확인하려면 오른쪽 버튼을 누르세요."} 값 대신 SHA-256 앞 8자리
              지문을 보여 주며, 두 곳의 지문이 다르면 서로 다른 키가 들어가 있는 것입니다.
            </>
          }
          action={
            <LinkButton href={live ? "/admin/system" : "/admin/system?check=1"} variant="secondary" className="h-8">
              {live ? "설정 여부만 보기" : "실제 호출로 점검"}
            </LinkButton>
          }
        />
        <KeyTable web={webKeys} github={doctor?.detail?.checks ?? null} />
        <p className="px-4 pb-4 pt-2 text-xs text-muted">
          GitHub 열:{" "}
          {doctor ? (
            <>
              {formatDate(doctor.started_at)} {doctor.detail?.source === "local" ? "로컬" : "Actions"} 실행 결과
              {doctor.detail?.run_url ? (
                <>
                  {" "}
                  (<Link href={doctor.detail.run_url} className="text-accent" target="_blank" rel="noreferrer">실행 기록</Link>)
                </>
              ) : null}
              . 매일 ETL 실행 때 갱신되며, 바로 확인하려면 GitHub → Actions → <b>Check keys</b> → Run workflow.
            </>
          ) : (
            <>아직 기록이 없습니다. GitHub → Actions → <b>Check keys</b> → Run workflow 를 실행하세요(DATABASE_URL 이 맞아야 여기에 표시됩니다. 틀리면 Actions 실행 요약에서 확인).</>
          )}{" "}
          Vercel 에서 환경 변수를 바꾼 뒤에는 재배포해야 반영됩니다.
        </p>
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
                <span className="block truncate text-xs text-muted">{j.detail ? redactSecrets(JSON.stringify(j.detail)).slice(0, 120) : ""}</span>
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
