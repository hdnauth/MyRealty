import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { readToken, pageUser, SESSION_COOKIE, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate, timeAgo } from "@/lib/format";
import { getSiteSettings } from "@/lib/site-settings";
import { cookies } from "next/headers";
import { getAreaUnit } from "@/lib/area-unit";
import { logoutAction, revokeSessionAction, setAreaUnitAction, setViewModeAction, updateNotificationSettingsAction } from "./actions";
import { FinanceProfileForm } from "@/components/brief/finance-form";
import { readFinanceProfile } from "@/lib/brief";
import { getViewMode } from "@/lib/view-mode";
import { DeleteAccount } from "./delete-account";
import { PushManager } from "./push-manager";
import { FontSizePicker, ThemePicker } from "@/components/shell/theme-picker";
import { MODEL, serverAiEnabled, userAiRow } from "@/lib/ai/client";
import { isAiProvider, PROVIDER_INFO } from "@/lib/ai/providers";
import { AiSettings } from "./ai-settings";

export const metadata: Metadata = { title: "설정" };

export default async function SettingsPage() {
  const uid = await sessionUserId();
  const [viewer, sessions, current, [ai], site, unit, aiRow, mode] = await Promise.all([
    pageUser(uid),
    sql<{ id: string; user_agent: string | null; created_at: string; last_seen_at: string | null; remember: boolean }[]>`
      select id, user_agent, created_at::text, last_seen_at::text, remember from sessions
      where user_id = ${uid} and revoked_at is null and expires_at > now() order by coalesce(last_seen_at, created_at) desc`,
    cookies().then((c) => readToken(c.get(SESSION_COOKIE)?.value)),
    sql<{ cost: number; calls: number; own_calls: number }[]>`
      select coalesce(sum(cost_usd), 0)::float8 as cost, count(*) filter (where not own_key)::int as calls,
        count(*) filter (where own_key)::int as own_calls
      from ai_usage where user_id = ${uid} and created_at >= date_trunc('month', now())`.catch(() => [{ cost: 0, calls: 0, own_calls: 0 }]),
    getSiteSettings(),
    getAreaUnit(),
    userAiRow(uid),
    getViewMode(),
  ]);
  const user = viewer ?? { email: null, isGuest: true, isAdmin: false, isEnvAdmin: false, settings: {} as Record<string, unknown> };
  const member = !user.isGuest;
  const savedAi =
    aiRow && isAiProvider(aiRow.provider)
      ? { provider: aiRow.provider, model: aiRow.model, baseUrl: aiRow.base_url, keyHint: aiRow.key_hint, updatedAt: aiRow.updated_at }
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="설정" />
      {member ? (
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
      ) : (
        <Card>
          <CardHeader
            title={viewer ? "게스트(이 기기)" : "로그인하지 않음"}
            sub={
              viewer
                ? "관심 부동산·구독·설정이 이 기기에 묶여 저장됩니다. 브라우저 데이터를 지우면 사라질 수 있어요."
                : "관심 부동산을 등록하면 이 기기에 저장됩니다."
            }
          />
          <div className="px-4 pb-4">
            <LinkButton href="/login?next=/settings" className="w-full sm:w-auto">이메일로 간편 가입 · 로그인</LinkButton>
            <p className="mt-2 text-xs text-muted">가입하면 다른 기기 동기화·이메일 요약·글쓰기·AI 질문을 쓸 수 있고, 지금까지 저장한 내용은 그대로 이어집니다.</p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="화면 테마" sub="시스템은 기기의 다크 모드 설정을 따릅니다. 이 기기에 저장됩니다(상단·사이드바의 해·달 버튼으로도 바꿀 수 있습니다)." />
        <ThemePicker />
      </Card>

      <Card>
        <CardHeader title="글자 크기" sub="글자·버튼·여백이 함께 커집니다. 이 기기에 저장됩니다." />
        <FontSizePicker />
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
        <CardHeader title="보기 방식" sub="기본 보기는 판정과 이유를 먼저 보여 주고, 통계 수치(z·회귀·분위)와 검증 표는 접어 둡니다. 이 기기에 저장됩니다." />
        <div className="flex gap-2 px-4 pb-4">
          {([
            ["simple", "기본 보기", "판정 · 이유 3가지 · 쉬운 말"],
            ["pro", "전문 보기", "모든 지표 · 검증 표 · 산식"],
          ] as const).map(([k, label, ex]) => (
            <form key={k} action={setViewModeAction} className="flex-1">
              <input type="hidden" name="mode" value={k} />
              <button
                type="submit"
                aria-pressed={mode === k}
                className={`w-full rounded-lg border px-3 py-2 text-left ${mode === k ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"}`}
              >
                <span className={`block text-sm font-semibold ${mode === k ? "text-accent" : ""}`}>{label}</span>
                <span className="block text-xs text-muted">{ex}</span>
              </button>
            </form>
          ))}
        </div>
      </Card>

      <Card id="finance" className="scroll-mt-20">
        <CardHeader title="내 자금" sub="매수 후보·관심 부동산과 단지 화면에서 “내 자금으로 살 수 있나”를 계산합니다. 비우고 저장하면 지웁니다." />
        <div className="px-4 pb-4">
          <FinanceProfileForm profile={readFinanceProfile(viewer?.settings)} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="알림"
          sub={
            member
              ? "중요 알림(신고가·강한 호재/악재 뉴스·만기 D-7)은 푸시로 즉시, 나머지는 매일 아침 이메일로 모아서 보냅니다."
              : "중요 알림(신고가·강한 호재/악재 뉴스·만기 D-7)을 이 기기로 푸시합니다. 이메일 요약은 가입 후 받을 수 있어요."
          }
        />
        <form action={updateNotificationSettingsAction} className="space-y-2 px-4 text-sm">
          {member ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="emailDigest" defaultChecked={user.settings.emailDigest !== false} /> 이메일 다이제스트 받기
            </label>
          ) : null}
          <label className="flex items-center gap-2">
            <input type="checkbox" name="pushEnabled" defaultChecked={user.settings.pushEnabled !== false} /> 중요 알림 푸시 받기
          </label>
          <Button type="submit" variant="secondary" className="h-8">저장</Button>
        </form>
        <div className="p-4">
          <PushManager vapidKey={env.vapidPublicKey ?? null} />
        </div>
      </Card>

      {member ? (
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
      ) : null}

      {member ? (
      <Card id="ai" className="scroll-mt-20">
        <CardHeader
          title="AI 모델"
          sub={
            savedAi
              ? `사용 중: ${PROVIDER_INFO[savedAi.provider].label} · ${savedAi.model} (내 키)`
              : serverAiEnabled()
                ? `사용 중: 서버 기본 (Claude · ${MODEL})`
                : "AI 질문·분석·비교·리포트에 쓸 제공자와 모델을 고르세요."
          }
        />
        <AiSettings key={savedAi?.updatedAt ?? "none"} saved={savedAi} serverDefault={serverAiEnabled() ? `Claude · ${MODEL}` : null} />
        <div className="border-t border-border px-4 py-3 text-sm">
          <span className="font-medium">이번 달 사용</span>{" "}
          <span className="text-muted">
            서버 기본 {ai.calls}회 · 약 ${ai.cost.toFixed(2)}
            {site.aiUserMonthlyLimitUsd !== null ? ` / 개인 한도 $${site.aiUserMonthlyLimitUsd}` : ""}
            {ai.own_calls ? ` · 내 키 ${ai.own_calls}회(비용은 제공자 계정으로 청구)` : ""}
          </span>
        </div>
      </Card>
      ) : null}

      {member ? (
        <Card className="border-up/30">
          <CardHeader title="회원 탈퇴" sub="관심 부동산·메모·알림·AI 기록이 모두 삭제되며 되돌릴 수 없습니다. 동네 이야기에 쓴 글·댓글은 '탈퇴한 사용자'로 남으니, 지우려면 탈퇴 전에 직접 삭제하세요." />
          <DeleteAccount email={user.email} disabled={user.isEnvAdmin} />
        </Card>
      ) : viewer ? (
        <Card className="border-up/30">
          <CardHeader title="이 기기 데이터 삭제" sub="이 기기에 저장한 관심 부동산·메모·알림·구독을 모두 지웁니다. 되돌릴 수 없습니다." />
          <DeleteAccount email={null} disabled={false} />
        </Card>
      ) : null}
      <nav className="flex flex-wrap gap-4 px-1 text-xs text-muted">
        <Link href="/legal/terms" className="hover:text-accent">이용약관</Link>
        <Link href="/legal/privacy" className="hover:text-accent">개인정보처리방침</Link>
        <Link href="/legal/account-deletion" className="hover:text-accent">계정 삭제 안내</Link>
        <Link href="/community/rules" className="hover:text-accent">동네 이야기 운영 원칙</Link>
      </nav>
    </div>
  );
}
