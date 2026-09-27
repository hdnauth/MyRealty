import { Markdown } from "@/components/ai/markdown";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { GenerateButtons } from "./generate-buttons";

export async function ReportsPanel({ userId, enabled }: { userId: string; enabled: boolean }) {
  const reports = await sql<{ id: number; scope: string; title: string | null; content_md: string; created_at: string; model: string | null }[]>`
    select id, scope, title, content_md, created_at::text, model from ai_reports
    where user_id = ${userId} and scope in ('weekly', 'monthly') order by created_at desc limit 20`;
  const latest = reports[0];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
      <Card>
        <CardHeader title={latest?.title ?? "리포트"} sub={latest ? `${formatDate(latest.created_at, "long")} · ${latest.model ?? ""}` : "매주 월요일·매월 1일 자동 생성(스케줄 설정 시)"} action={<GenerateButtons enabled={enabled} />} />
        <div className="px-4 pb-4">
          {latest ? <Markdown>{latest.content_md}</Markdown> : <EmptyState title="아직 리포트가 없습니다" desc="‘주간 리포트 생성’을 누르면 관심 부동산·지표·뉴스·일정을 요약합니다." />}
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="지난 리포트" />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {reports.slice(1).map((r) => (
            <li key={r.id} className="py-2">
              <details>
                <summary className="cursor-pointer">{r.title}</summary>
                <div className="mt-2"><Markdown>{r.content_md}</Markdown></div>
              </details>
            </li>
          ))}
          {reports.length <= 1 ? <li className="py-2 text-muted">없음</li> : null}
        </ul>
      </Card>
    </div>
  );
}
