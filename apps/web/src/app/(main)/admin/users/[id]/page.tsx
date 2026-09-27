import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, CardHeader, Input, Stat, Textarea } from "@/components/ui";
import { envAdmin } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatDate, timeAgo } from "@/lib/format";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/property";
import { ActionForm } from "../../action-form";
import {
  deleteUserAction,
  revokeSessionAction,
  revokeUserSessionsAction,
  setUserRoleAction,
  setUserStatusAction,
  updateUserProfileAction,
} from "../../actions";

export const metadata: Metadata = { title: "사용자 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminUserDetail(props: PageProps<"/admin/users/[id]">) {
  const admin = await requireAdmin();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const [u] = await sql<{
    id: string; email: string; display_name: string | null; role: string; status: string; admin_note: string | null;
    created_at: string; last_login_at: string | null; blocked_at: string | null; settings: Record<string, unknown>;
  }[]>`
    select id, email, display_name, role, status, admin_note, created_at::text, last_login_at::text, blocked_at::text, settings
    from users where id = ${id}`;
  if (!u) notFound();

  const [sessions, items, ai, counts] = await Promise.all([
    sql<{ id: string; user_agent: string | null; ip: string | null; created_at: string; last_seen_at: string | null; expires_at: string; remember: boolean }[]>`
      select id, user_agent, ip, created_at::text, last_seen_at::text, expires_at::text, remember from sessions
      where user_id = ${id} and revoked_at is null and expires_at > now() order by coalesce(last_seen_at, created_at) desc`,
    sql<{ id: string; label: string; property_type: PropertyType; road_address: string | null; created_at: string }[]>`
      select id, label, property_type, road_address, created_at::text from watch_items where user_id = ${id} order by created_at desc limit 50`,
    sql<{ purpose: string; calls: number; cost: number }[]>`
      select purpose, count(*)::int as calls, coalesce(sum(cost_usd), 0)::float8 as cost from ai_usage
      where user_id = ${id} and created_at >= date_trunc('month', now()) group by purpose order by cost desc`,
    sql<{ notes: number; notifications: number; reports: number; push: number; custom: number }[]>`
      select (select count(*) from notes where user_id = ${id})::int as notes,
             (select count(*) from notifications where user_id = ${id})::int as notifications,
             (select count(*) from ai_reports where user_id = ${id})::int as reports,
             (select count(*) from push_subscriptions where user_id = ${id})::int as push,
             (select count(*) from custom_indicators where user_id = ${id})::int as custom`,
  ]);
  const c = counts[0];
  const isSelf = u.id === admin.id;
  const isEnv = envAdmin(u.email);
  const isAdmin = u.role === "admin" || isEnv;
  const locked = isSelf || isEnv;
  const aiTotal = ai.reduce((s, r) => s + r.cost, 0);

  return (
    <div className="space-y-4">
      <Link href="/admin/users" className="text-sm text-accent">← 사용자 목록</Link>
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-1.5">
              {u.email}
              {isAdmin ? <Badge tone="warn">관리자{isEnv ? "(환경 변수)" : ""}</Badge> : null}
              {u.status === "blocked" ? <Badge tone="up">정지됨</Badge> : <Badge tone="ok">정상</Badge>}
              {isSelf ? <Badge tone="accent">나</Badge> : null}
            </span>
          }
          sub={`가입 ${formatDate(u.created_at, "long")} · 최근 로그인 ${u.last_login_at ? timeAgo(u.last_login_at) : "-"}${u.blocked_at ? ` · 정지 ${formatDate(u.blocked_at, "long")}` : ""}`}
        />
        <div className="grid grid-cols-3 gap-4 p-4 md:grid-cols-6">
          <Stat label="관심 부동산" value={items.length} />
          <Stat label="메모" value={c.notes} />
          <Stat label="알림" value={c.notifications} />
          <Stat label="AI 리포트" value={c.reports} />
          <Stat label="푸시 기기" value={c.push} />
          <Stat label="이번 달 AI" value={`$${aiTotal.toFixed(2)}`} />
        </div>
      </Card>

      <Card>
        <CardHeader title="계정 관리" sub={locked ? (isSelf ? "자기 계정은 정지·강등·삭제할 수 없습니다." : "ADMIN_EMAILS 로 지정된 관리자는 환경 변수에서만 변경할 수 있습니다.") : undefined} />
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {u.status === "active" ? (
            <ActionForm action={setUserStatusAction} confirm={`${u.email} 의 이용을 정지할까요? 모든 기기에서 로그아웃됩니다.`} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="status" value="blocked" />
              <Button type="submit" variant="danger" disabled={locked}>이용 정지</Button>
            </ActionForm>
          ) : (
            <ActionForm action={setUserStatusAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="status" value="active" />
              <Button type="submit">정지 해제</Button>
            </ActionForm>
          )}
          <ActionForm action={setUserRoleAction} confirm={u.role === "admin" ? "관리자 권한을 해제할까요?" : `${u.email} 에게 관리자 권한을 줄까요?`} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={u.id} />
            <input type="hidden" name="role" value={u.role === "admin" ? "user" : "admin"} />
            <Button type="submit" variant="secondary" disabled={isEnv || (isSelf && u.role === "admin")}>
              {u.role === "admin" ? "관리자 해제" : "관리자 지정"}
            </Button>
          </ActionForm>
          <ActionForm action={revokeUserSessionsAction} confirm="이 사용자의 모든 기기를 로그아웃시킬까요?" className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={u.id} />
            <Button type="submit" variant="secondary" disabled={!sessions.length}>모든 기기 로그아웃</Button>
          </ActionForm>
        </div>
      </Card>

      <Card>
        <CardHeader title="프로필 · 관리자 메모" sub="메모는 관리자만 볼 수 있습니다." />
        <ActionForm action={updateUserProfileAction} className="space-y-2 px-4 pb-4">
          <input type="hidden" name="id" value={u.id} />
          <Input name="displayName" defaultValue={u.display_name ?? ""} placeholder="표시 이름" maxLength={50} />
          <Textarea name="note" defaultValue={u.admin_note ?? ""} rows={3} placeholder="관리자 메모" maxLength={1000} />
          <Button type="submit" variant="secondary" className="h-8">저장</Button>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title={`로그인된 기기 ${sessions.length}`} />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate">{s.user_agent?.slice(0, 80) ?? "알 수 없음"}</span>
                <span className="block text-xs text-muted">
                  {s.remember ? "기억된 기기" : "일회성"} · 로그인 {formatDate(s.created_at, "long")} · 최근 {s.last_seen_at ? timeAgo(s.last_seen_at) : "-"}
                  {s.ip ? ` · ${s.ip}` : ""} · 만료 {formatDate(s.expires_at)}
                </span>
              </span>
              {s.id === admin.sessionId ? (
                <span className="shrink-0 text-xs text-accent">현재 기기</span>
              ) : (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="shrink-0 text-xs text-up">로그아웃</button>
                </form>
              )}
            </li>
          ))}
          {!sessions.length ? <li className="py-2 text-muted">로그인된 기기가 없습니다.</li> : null}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={`관심 부동산 ${items.length}`} />
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">
                  <Badge>{PROPERTY_TYPES[i.property_type]?.label ?? i.property_type}</Badge> {i.label}
                  <span className="block truncate text-xs text-muted">{i.road_address ?? ""}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{formatDate(i.created_at)}</span>
              </li>
            ))}
            {!items.length ? <li className="py-2 text-muted">등록한 부동산이 없습니다.</li> : null}
          </ul>
        </Card>
        <Card>
          <CardHeader title="이번 달 AI 사용" />
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {ai.map((r) => (
              <li key={r.purpose} className="flex items-center justify-between py-2">
                <span className="font-mono text-xs">{r.purpose}</span>
                <span className="tabular text-muted">{r.calls}회 · ${r.cost.toFixed(3)}</span>
              </li>
            ))}
            {!ai.length ? <li className="py-2 text-muted">사용 기록이 없습니다.</li> : null}
          </ul>
        </Card>
      </div>

      {!locked ? (
        <Card className="border-up/40">
          <CardHeader title="계정 삭제" sub="관심 부동산·메모·알림·AI 기록·세션이 모두 삭제되며 되돌릴 수 없습니다. 같은 이메일로 다시 가입할 수는 있습니다(막으려면 정지)." />
          <ActionForm action={deleteUserAction} confirm="정말 삭제할까요? 되돌릴 수 없습니다." className="flex flex-wrap gap-2 px-4 pb-4">
            <input type="hidden" name="id" value={u.id} />
            <Input name="confirm" placeholder={`확인: ${u.email} 입력`} autoComplete="off" className="min-w-56 flex-1" />
            <Button type="submit" variant="danger">삭제</Button>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
