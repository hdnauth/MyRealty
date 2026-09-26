import type { Metadata } from "next";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { deleteProjectAction } from "./actions";
import { ProjectForm } from "./project-form";

export const metadata: Metadata = { title: "개발사업" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const zones = await sql<{ id: number; name: string; kind: string; stage: string | null; stage_date: string | null; source_key: string }[]>`
    select id, name, kind, stage, stage_date::text, source_key from redevelopment_zones order by updated_at desc limit 200`;
  const infra = await sql<{ id: number; name: string; kind: string; line_name: string | null; status: string; expected_open: string | null; source_key: string }[]>`
    select id, name, kind, line_name, status, expected_open::text, source_key from infra_projects order by updated_at desc limit 200`;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="개발사업" sub="재개발·재건축 구역과 철도·도로 사업. 입지 점수와 지도·물건 입지 탭에 반영됩니다." />
      {user.isAdmin ? (
        <Card>
          <CardHeader title="직접 등록" sub="GeoJSON/CSV 일괄 등록: uv run myrealty import-geo 파일 --kind zones|infra" />
          <ProjectForm />
        </Card>
      ) : null}
      <Card>
        <CardHeader title={`정비사업 ${zones.length}`} />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {zones.map((z) => (
            <li key={z.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate"><Badge>{z.kind}</Badge> {z.name} <span className="text-xs text-muted">{z.stage ?? ""} {formatDate(z.stage_date)}</span></span>
              {user.isAdmin ? <form action={deleteProjectAction}><input type="hidden" name="id" value={z.id} /><input type="hidden" name="type" value="zone" /><button className="text-xs text-up">삭제</button></form> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title={`철도·도로 ${infra.length}`} />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {infra.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate"><Badge tone="accent">{p.status}</Badge> {p.name} <span className="text-xs text-muted">{p.line_name ?? ""} {p.expected_open ? `개통 ${p.expected_open.slice(0, 7)}` : ""}</span></span>
              {user.isAdmin ? <form action={deleteProjectAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="type" value="infra" /><button className="text-xs text-up">삭제</button></form> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
