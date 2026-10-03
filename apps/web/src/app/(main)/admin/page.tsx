import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, Stat } from "@/components/ui";
import { health, listUsers, siteStats, usageStats } from "@/lib/admin";
import { UsageCards } from "./usage-card";
import { SIGNUP_MODES } from "@/lib/auth/policy";
import { formatNumber, timeAgo } from "@/lib/format";
import { getSiteSettings } from "@/lib/site-settings";
import { sql } from "@/lib/db";

export const metadata: Metadata = { title: "개요" };

export default async function AdminHome() {
  const [stats, recent, h, site, usage, [regions]] = await Promise.all([
    siteStats(),
    listUsers({ page: 1 }),
    health(),
    getSiteSettings(),
    usageStats(),
    sql<{ pending: number }[]>`select count(distinct sgg_cd)::int as pending from region_requests where status = 'pending'`,
  ]);
  const { users, counts } = stats;
  const budget = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 30);
  const mode = SIGNUP_MODES.find((m) => m.value === site.signupMode)!;
  const problems = [
    h.db !== "ok" ? "DB 연결 오류" : null,
    h.migrations?.pending.length ? `미적용 마이그레이션 ${h.migrations.pending.length}개` : null,
    !h.authSecret ? "AUTH_SECRET 미설정" : null,
    !h.smtp ? "SMTP 미설정(로그인 코드가 서버 로그로만 출력)" : null,
    regions?.pending ? `지역 요청 대기 ${regions.pending}곳` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {problems.length ? (
        <Card className="border-warn/40">
          <div className="flex flex-wrap items-center gap-2 p-4 text-sm">
            <Badge tone="warn">점검 필요</Badge>
            {problems.join(" · ")}
            <Link href={regions?.pending && problems.length === 1 ? "/admin/regions" : "/admin/system"} className="ml-auto text-accent">
              {regions?.pending && problems.length === 1 ? "수집 지역 →" : "시스템 →"}
            </Link>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
          <Stat label="가입 사용자" value={formatNumber(users.total)} sub={<span className="text-muted">게스트 {users.guests} · 정지 {users.blocked} · 관리자 {users.admins}</span>} />
          <Stat label="신규 가입" value={`${users.new7}명`} sub={<span className="text-muted">7일 · 30일 {users.new30}명</span>} />
          <Stat label="활성 사용자" value={`${users.seen7}명`} sub={<span className="text-muted">7일 · 오늘 {users.seen1}명</span>} />
          <Stat label="로그인 세션" value={formatNumber(counts.sessions)} sub={<span className="text-muted">7일 로그인 {counts.logins7}회</span>} />
          <Stat label="관심 부동산" value={formatNumber(counts.items)} />
          <Stat label="알림(7일)" value={formatNumber(counts.notifications7)} />
          <Stat label="AI 리포트" value={formatNumber(counts.reports)} />
          <Stat
            label="이번 달 AI"
            value={`$${counts.ai_cost.toFixed(2)}`}
            sub={<span className={counts.ai_cost >= budget ? "text-up" : "text-muted"}>{counts.ai_calls}회 · 예산 ${budget}</span>}
          />
        </div>
      </Card>

      <UsageCards u={usage} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="일별 가입(30일)" sub={<>가입 방식: <b>{mode.label}</b> · <Link href="/admin/settings" className="text-accent">변경</Link></>} />
          <SignupBars days={stats.signups} />
        </Card>
        <Card>
          <CardHeader title="최근 가입" action={<Link href="/admin/users" className="text-accent">전체 →</Link>} />
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {recent.rows.slice(0, 8).map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/admin/users/${u.id}`} className="min-w-0 truncate hover:underline">
                  {u.email ?? "게스트(기기)"}
                </Link>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                  {u.status === "blocked" ? <Badge tone="up">정지</Badge> : null}
                  {timeAgo(u.created_at)}
                </span>
              </li>
            ))}
            {!recent.rows.length ? <li className="py-2 text-muted">아직 사용자가 없습니다.</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** 일별 가입 수 막대(정수 카운트라 축 없이 막대 위에 값 표시) */
function SignupBars({ days }: { days: { d: string; n: number }[] }) {
  const max = Math.max(1, ...days.map((x) => x.n));
  const total = days.reduce((a, x) => a + x.n, 0);
  return (
    <div className="px-4 pb-4">
      <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`최근 30일 가입 ${total}명`}>
        {days.map((x) => (
          <div key={x.d} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${x.d} · ${x.n}명`}>
            {x.n ? <span className="tabular mb-0.5 text-center text-[0.75rem] text-muted">{x.n}</span> : null}
            <div className="rounded-t-sm" style={{ height: `${(x.n / max) * 80}%`, minHeight: x.n ? 3 : 1, background: x.n ? "var(--series-1)" : "var(--chart-grid)" }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[0.75rem] text-muted">
        <span>{days[0]?.d.slice(5).replace("-", ".")}</span>
        <span>30일 합계 {total}명</span>
        <span>오늘</span>
      </div>
    </div>
  );
}
