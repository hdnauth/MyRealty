import type { Metadata } from "next";
import { Button, Card, CardHeader, Input, PageHeader } from "@/components/ui";
import { readToken, requireUser, SESSION_COOKIE } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { cookies } from "next/headers";
import { addAllowedEmailAction, logoutAction, removeAllowedEmailAction, revokeSessionAction, updateNotificationSettingsAction } from "./actions";
import { PushManager } from "./push-manager";

export const metadata: Metadata = { title: "설정" };

export default async function SettingsPage() {
  const user = await requireUser();
  const allowed = await sql<{ email: string; note: string | null }[]>`select email, note from allowed_emails order by created_at`;
  const sessions = await sql<{ id: string; user_agent: string | null; created_at: string }[]>`
    select id, user_agent, created_at::text from sessions
    where user_id = ${user.id} and revoked_at is null and expires_at > now() order by created_at desc`;
  const current = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
  const keys = [
    ["공공데이터포털(실거래·건축물대장·청약)", "DATA_GO_KR_KEY", "ETL"],
    ["도로명주소 검색", "JUSO_KEY", Boolean(env.jusoKey)],
    ["네이버 지도/지오코딩", "NCP_MAPS_KEY_ID / NCP_MAPS_KEY", Boolean(env.ncpKeyId)],
    ["Claude API", "ANTHROPIC_API_KEY", Boolean(env.anthropicApiKey)],
    ["SMTP 메일", "SMTP_HOST", Boolean(env.smtp.host)],
    ["웹푸시(VAPID)", "NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY", Boolean(env.vapidPublicKey && env.vapidPrivateKey)],
  ] as const;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="설정" />
      <Card>
        <CardHeader title="계정" sub={user.email} action={<form action={logoutAction}><Button variant="secondary" type="submit">로그아웃</Button></form>} />
        <div className="h-2" />
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
        <CardHeader title="로그인 허용 이메일" sub="이 목록(과 환경 변수 ALLOWED_EMAILS)에 있는 이메일만 로그인 코드를 받을 수 있습니다." />
        <ul className="divide-y divide-border px-4 text-sm">
          {env.allowedEmails.map((e) => (
            <li key={`env-${e}`} className="flex items-center justify-between py-2">
              <span>{e}</span>
              <span className="text-xs text-muted">환경 변수</span>
            </li>
          ))}
          {allowed.map((a) => (
            <li key={a.email} className="flex items-center justify-between py-2">
              <span>{a.email}</span>
              {a.email !== user.email ? (
                <form action={removeAllowedEmailAction}>
                  <input type="hidden" name="email" value={a.email} />
                  <button className="text-xs text-up">삭제</button>
                </form>
              ) : (
                <span className="text-xs text-muted">나</span>
              )}
            </li>
          ))}
        </ul>
        <form action={addAllowedEmailAction} className="flex gap-2 p-4">
          <Input name="email" type="email" placeholder="가족 이메일 추가" required />
          <Button type="submit" variant="secondary">추가</Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="로그인된 기기" />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-muted">
                {formatDate(s.created_at, "long")} · {s.user_agent?.slice(0, 60) ?? "알 수 없음"}
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
        <CardHeader title="외부 API 연결 상태" sub="키는 리포지토리 루트 .env 에서 설정합니다." />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {keys.map(([name, envName, ok]) => (
            <li key={envName} className="flex items-center justify-between gap-2 py-2">
              <span>
                {name}
                <span className="block text-xs text-muted">{envName}</span>
              </span>
              <span className={ok === "ETL" ? "text-xs text-muted" : ok ? "text-xs font-medium text-ok" : "text-xs text-muted"}>
                {ok === "ETL" ? "ETL에서 사용" : ok ? "연결됨" : "미설정"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
