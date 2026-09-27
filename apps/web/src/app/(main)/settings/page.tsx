import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { readToken, requireUser, SESSION_COOKIE, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate, timeAgo } from "@/lib/format";
import { getSiteSettings } from "@/lib/site-settings";
import { cookies } from "next/headers";
import { getAreaUnit } from "@/lib/area-unit";
import { logoutAction, revokeSessionAction, setAreaUnitAction, updateNotificationSettingsAction } from "./actions";
import { DeleteAccount } from "./delete-account";
import { PushManager } from "./push-manager";

export const metadata: Metadata = { title: "설정" };

export default async function SettingsPage() {
  const uid = await sessionUserId();
  const [user, sessions, current, [ai], site, unit] = await Promise.all([
    requireUser(),
    sql<{ id: string; user_agent: string | null; created_at: string; last_seen_at: string | null; remember: boolean }[]>`
      select id, user_agent, created_at::text, last_seen_at::text, remember from sessions
      where user_id = ${uid} and revoked_at is null and expires_at > now() order by coalesce(last_seen_at, created_at) desc`,
    cookies().then((c) => readToken(c.get(SESSION_COOKIE)?.value)),
    sql<{ cost: number; calls: number }[]>`
      select coalesce(sum(cost_usd), 0)::float8 as cost, count(*)::int as calls from ai_usage
      where user_id = ${uid} and created_at >= date_trunc('month', now())`,
    getSiteSettings(),
    getAreaUnit(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="메뉴 · 설정" />
      <Card className="lg:hidden">
        <div className="grid grid-cols-3 gap-1 p-2 text-center text-sm">
          {[
            ["/portfolio", "포트폴리오"],
            ["/compare", "비교"],
            ["/calendar", "캘린더"],
            ["/projects", "개발사업"],
            ["/indicators/custom", "커스텀 지표"],
            ["/notifications", "알림"],
            ...(user.isAdmin ? [["/admin", "관리"]] : []),
          ].map(([href, label]) => (
            <Link key={href} href={href} className="rounded-lg px-2 py-3 hover:bg-surface-2">
              {label}
            </Link>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader
          title="계정"
          sub={`${user.email}${user.isAdmin ? " · 관리자" : ""}`}
          action={<form action={logoutAction}><Button variant="secondary" type="submit">로그아웃</Button></form>}
        />
        {user.isAdmin ? (
          <div className="px-4 pb-3">
            <Link href="/admin" className="text-sm font-medium text-accent">관리 화면 열기 →</Link>
          </div>
        ) : (
          <div className="h-2" />
        )}
      </Card>

      <Card>
        <CardHeader title="표시 단위" sub="면적과 단위면적당 가격(평당가·㎡당가)을 어느 단위로 먼저 보여 줄지 정합니다. 이 기기에 저장됩니다." />
        <div className="flex gap-2 px-4 pb-4">
          {([
            ["m2", "㎡ 우선", "84.9㎡ (25.7평) · ㎡당가"],
            ["pyeong", "평 우선", "25.7평 (84.9㎡) · 평당가"],
          ] as const).map(([k, label, ex]) => (
            <form key={k} action={setAreaUnitAction} className="flex-1">
              <input type="hidden" name="unit" value={k} />
              <button
                type="submit"
                aria-pressed={unit === k}
                className={`w-full rounded-lg border px-3 py-2 text-left ${unit === k ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"}`}
              >
                <span className={`block text-sm font-semibold ${unit === k ? "text-accent" : ""}`}>{label}</span>
                <span className="block text-xs text-muted">{ex}</span>
              </button>
            </form>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="알림" sub="중요 알림(신고가·강한 호재/악재 뉴스·만기 D-7)은 푸시로 즉시, 나머지는 매일 아침 이메일로 모아서 보냅니다." />
        <form action={updateNotificationSettingsAction} className="space-y-2 px-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="emailDigest" defaultChecked={user.settings.emailDigest !== false} /> 이메일 다이제스트 받기
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="pushEnabled" defaultChecked={user.settings.pushEnabled !== false} /> 중요 알림 푸시 받기
          </label>
          <Button type="submit" variant="secondary" className="h-8">저장</Button>
        </form>
        <div className="p-4">
          <PushManager vapidKey={env.vapidPublicKey ?? null} />
        </div>
      </Card>

      <Card>
        <CardHeader title="로그인된 기기" sub="“이 기기 기억하기”로 로그인한 기기는 90일 동안(접속할 때마다 연장) 자동 로그인됩니다." />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-muted">
                {s.remember ? "기억됨" : "일회성"} · {formatDate(s.created_at, "long")}
                {s.last_seen_at ? ` · 최근 ${timeAgo(s.last_seen_at)}` : ""} · {s.user_agent?.slice(0, 60) ?? "알 수 없음"}
              </span>
              {s.id === current?.sid ? (
                <span className="shrink-0 text-xs text-accent">현재 기기</span>
              ) : (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="shrink-0 text-xs text-up">로그아웃</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="이번 달 AI 사용" sub="AI 질문·분석·비교·리포트 사용량입니다." />
        <p className="px-4 pb-4 text-sm">
          {ai.calls}회 · 약 ${ai.cost.toFixed(2)}
          {site.aiUserMonthlyLimitUsd !== null ? <span className="text-muted"> / 개인 한도 ${site.aiUserMonthlyLimitUsd}</span> : null}
        </p>
      </Card>

      <Card className="border-up/30">
        <CardHeader title="회원 탈퇴" sub="관심 부동산·메모·알림·AI 기록이 모두 삭제되며 되돌릴 수 없습니다." />
        <DeleteAccount email={user.email} disabled={user.isEnvAdmin} />
      </Card>
    </div>
  );
}
