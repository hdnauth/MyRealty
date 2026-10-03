import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { envAdmin, listUsers, USERS_PAGE_SIZE } from "@/lib/admin";
import { formatDate, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "사용자" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

export default async function AdminUsers(props: PageProps<"/admin/users">) {
  const sp = await props.searchParams;
  const f = { q: str(sp.q), status: str(sp.status), role: str(sp.role), kind: str(sp.kind), page: Number(str(sp.page)) || 1 };
  const { total, rows, page } = await listUsers(f);
  const pages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (f.q) u.set("q", f.q);
    if (f.status) u.set("status", f.status);
    if (f.role) u.set("role", f.role);
    if (f.kind) u.set("kind", f.kind);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-4">
      <Card>
        <form className="flex flex-wrap items-end gap-2 p-4" role="search">
          <Input name="q" defaultValue={f.q} placeholder="이메일·이름 검색" className="min-w-48 flex-1" />
          <Select name="status" defaultValue={f.status} className="w-auto">
            <option value="">전체 상태</option>
            <option value="active">정상</option>
            <option value="blocked">정지</option>
          </Select>
          <Select name="kind" defaultValue={f.kind} className="w-auto">
            <option value="">가입 사용자</option>
            <option value="guest">기기 게스트</option>
            <option value="all">전체</option>
          </Select>
          <Select name="role" defaultValue={f.role} className="w-auto">
            <option value="">전체 역할</option>
            <option value="admin">관리자</option>
            <option value="user">일반</option>
          </Select>
          <Button type="submit" variant="secondary">검색</Button>
        </form>
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 pt-3 text-sm text-muted">
          <span>{total}명</span>
          <span>{page} / {pages} 페이지</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">이메일</th>
                <th className="px-2 py-2 font-medium">상태</th>
                <th className="px-2 py-2 text-right font-medium">부동산</th>
                <th className="px-2 py-2 text-right font-medium">기기</th>
                <th className="px-2 py-2 text-right font-medium">AI(월)</th>
                <th className="px-2 py-2 font-medium">가입</th>
                <th className="px-4 py-2 font-medium">최근 접속</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-surface-2">
                  <td className="max-w-64 px-4 py-2">
                    <Link href={`/admin/users/${u.id}`} className="block truncate font-medium hover:underline">
                      {u.email ?? <span className="text-muted">게스트(기기)</span>}
                    </Link>
                    {u.display_name ? <span className="block truncate text-xs text-muted">{u.display_name}</span> : null}
                  </td>
                  <td className="px-2 py-2">
                    <span className="flex gap-1">
                      {u.role === "admin" || envAdmin(u.email) ? <Badge tone="warn">관리자</Badge> : null}
                      {u.status === "blocked" ? <Badge tone="up">정지</Badge> : <Badge tone="ok">정상</Badge>}
                    </span>
                  </td>
                  <td className="tabular px-2 py-2 text-right">{u.items}</td>
                  <td className="tabular px-2 py-2 text-right">{u.sessions}</td>
                  <td className="tabular px-2 py-2 text-right">{u.ai_cost ? `$${u.ai_cost.toFixed(2)}` : "-"}</td>
                  <td className="px-2 py-2 text-muted">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-2 text-muted">{u.last_seen_at ?? u.last_login_at ? timeAgo((u.last_seen_at ?? u.last_login_at)!) : "-"}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted">조건에 맞는 사용자가 없습니다.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="flex justify-center gap-3 p-3 text-sm">
            {page > 1 ? <Link href={`/admin/users${qs(page - 1)}`} className="text-accent">← 이전</Link> : null}
            {page < pages ? <Link href={`/admin/users${qs(page + 1)}`} className="text-accent">다음 →</Link> : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
