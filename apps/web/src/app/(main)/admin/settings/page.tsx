import type { Metadata } from "next";
import { Button, Card, CardHeader, Input, Textarea } from "@/components/ui";
import { SIGNUP_MODES } from "@/lib/auth/policy";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { getSiteSettings } from "@/lib/site-settings";
import { ActionForm } from "../action-form";
import { addAllowedEmailAction, removeAllowedEmailAction, saveSiteSettingsAction } from "../actions";

export const metadata: Metadata = { title: "사이트 설정" };

export default async function AdminSettings() {
  const site = await getSiteSettings();
  const allowed = await sql<{ email: string; note: string | null; created_at: string; joined: boolean }[]>`
    select a.email, a.note, a.created_at::text, exists (select 1 from users u where u.email = a.email) as joined
    from allowed_emails a order by a.created_at desc`;
  const budget = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 30);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="가입 · 공지 · AI 한도" />
        <ActionForm action={saveSiteSettingsAction} className="space-y-5 px-4 pb-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] font-medium text-muted">가입 방식</legend>
            {SIGNUP_MODES.map((m) => (
              <label key={m.value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="signupMode" value={m.value} defaultChecked={site.signupMode === m.value} className="mt-1" />
                <span>
                  <span className="font-medium">{m.label}</span>
                  <span className="block text-xs text-muted">{m.desc}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-muted">ADMIN_EMAILS 의 관리자와 이미 가입한 사용자는 가입 방식과 관계없이 로그인할 수 있습니다(정지된 계정 제외).</p>
          </fieldset>

          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-muted">사용자 1인당 월 AI 한도(USD)</span>
            <Input name="aiUserMonthlyLimitUsd" type="number" min={0} step="0.5" defaultValue={site.aiUserMonthlyLimitUsd ?? ""} placeholder="비우면 제한 없음" className="max-w-48" />
            <span className="mt-1 block text-xs text-muted">전체 월 예산은 환경 변수 AI_MONTHLY_BUDGET_USD(현재 ${budget})입니다. 둘 중 먼저 닿는 한도가 적용됩니다.</span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-muted">공지(모든 화면 상단)</span>
            <Textarea name="notice" defaultValue={site.notice} rows={2} maxLength={300} placeholder="예) 9/30 02:00~03:00 점검 예정" />
          </label>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] font-medium text-muted">동네 이야기(커뮤니티)</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="communityEnabled" defaultChecked={site.communityEnabled} className="mt-1" />
              <span>글·댓글 작성 허용 <span className="block text-xs text-muted">끄면 읽기만 가능(관리자는 계속 쓸 수 있음)</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="communityAiModeration" defaultChecked={site.communityAiModeration} className="mt-1" />
              <span>AI 자동 검토 <span className="block text-xs text-muted">새 글·댓글을 서버 AI(ANTHROPIC_API_KEY)로 점검: 명백한 위반은 가리고, 애매하면 보류, 규칙에 걸렸어도 문제없으면 공개</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="communityAiAnswer" defaultChecked={site.communityAiAnswer} className="mt-1" />
              <span>질문에 AI 첫 답변 <span className="block text-xs text-muted">질문 글에 실거래·지표 기반 답을 서버 AI 비용으로 단다(서버 월 예산 안에서)</span></span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              신고
              <Input name="communityAutoHideReports" type="number" min={1} max={20} defaultValue={site.communityAutoHideReports} className="h-9 w-20" />
              건이 모이면 자동으로 가리기
            </label>
          </fieldset>

          <Button type="submit">저장</Button>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader
          title={`가입 허용 목록 ${allowed.length + env.allowedEmails.length}`}
          sub={site.signupMode === "allowlist" ? "현재 가입 방식이 “허용 목록만”이라 이 목록의 이메일만 새로 가입할 수 있습니다." : "가입 방식을 “허용 목록만”으로 바꾸면 이 목록이 적용됩니다."}
        />
        <ActionForm action={addAllowedEmailAction} className="flex flex-wrap gap-2 px-4 pb-2">
          <Input name="emails" placeholder="이메일(여러 개는 쉼표·공백으로 구분)" className="min-w-56 flex-1" required />
          <Button type="submit" variant="secondary">추가</Button>
        </ActionForm>
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {env.allowedEmails.map((e) => (
            <li key={`env-${e}`} className="flex items-center justify-between py-2">
              <span>{e}</span>
              <span className="text-xs text-muted">환경 변수 ALLOWED_EMAILS</span>
            </li>
          ))}
          {allowed.map((a) => (
            <li key={a.email} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">
                {a.email}
                <span className="block text-xs text-muted">
                  {formatDate(a.created_at)} 추가{a.joined ? " · 가입함" : ""}
                </span>
              </span>
              <form action={removeAllowedEmailAction}>
                <input type="hidden" name="email" value={a.email} />
                <button className="text-xs text-up">삭제</button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
