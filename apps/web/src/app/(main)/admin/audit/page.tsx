import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "작업 기록" };

const LABELS: Record<string, string> = {
  "user.block": "이용 정지",
  "user.unblock": "정지 해제",
  "user.grant_admin": "관리자 지정",
  "user.revoke_admin": "관리자 해제",
  "user.revoke_sessions": "모든 기기 로그아웃",
  "user.update_profile": "프로필·메모 수정",
  "user.delete": "계정 삭제",
  "session.revoke": "기기 로그아웃",
  "site.settings": "사이트 설정 변경",
  "allowlist.add": "허용 목록 추가",
  "allowlist.remove": "허용 목록 삭제",
  "system.cleanup": "정리 작업",
};

export default async function AdminAudit() {
  const rows = await sql<{ id: number; admin_email: string; action: string; target: string | null; detail: unknown; created_at: string }[]>`
    select id, admin_email, action, target, detail, created_at::text from admin_audit_log order by created_at desc limit 200`;
  return (
    <Card>
      <CardHeader title="관리자 작업 기록" sub="최근 200건" />
      <ul className="divide-y divide-border px-4 pb-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="font-medium">{LABELS[r.action] ?? r.action}</span>
                {r.target ? <span className="text-muted"> · {r.target}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted">{formatDate(r.created_at, "long")} {r.created_at.slice(11, 16)}</span>
            </div>
            <div className="truncate text-xs text-muted">
              {r.admin_email}
              {r.detail ? ` · ${JSON.stringify(r.detail).slice(0, 140)}` : ""}
            </div>
          </li>
        ))}
        {!rows.length ? <li className="py-2 text-muted">기록이 없습니다.</li> : null}
      </ul>
    </Card>
  );
}
