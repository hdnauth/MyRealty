import { FileText, MessageSquarePlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Chat, type ChatMsg } from "@/components/ai/chat";
import { MemberGate } from "@/components/shell/member-gate";
import { Card, PageHeader, Tabs } from "@/components/ui";
import { AiSetupNotice } from "@/components/ai/setup-notice";
import { aiStatus } from "@/lib/ai/client";
import { pageUser, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { ReportsPanel } from "./reports-panel";

export const metadata: Metadata = { title: "AI" };

export default async function AiPage(props: PageProps<"/ai">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  const view = sp.view === "reports" ? "reports" : "chat";
  const wanted = typeof sp.c === "string" && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : null;
  const [user, convs, rows] = await Promise.all([
    pageUser(uid),
    sql<{ id: string; title: string | null; updated_at: string }[]>`
      select id, title, updated_at::text from ai_conversations where user_id = ${uid} order by updated_at desc limit 30`,
    // 대화 목록과 동시에 조회하되 내 대화인지는 같은 쿼리에서 확인
    wanted
      ? sql<{ role: "user" | "assistant"; content: { text: string; tools?: { name: string }[] } }[]>`
          select m.role, m.content from ai_messages m join ai_conversations c on c.id = m.conversation_id
          where m.conversation_id = ${wanted} and c.user_id = ${uid} order by m.id`
      : Promise.resolve([]),
  ]);
  if (!user || user.isGuest) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title="AI 질문" sub="내 관심 부동산·실거래·지표 데이터를 직접 조회해 답하는 AI" />
        <MemberGate
          title="AI 질문은 가입 후 이용할 수 있어요"
          desc="“우리 단지 최근 실거래 추이 어때?”, “금리가 내리면 이 지역 영향은?”처럼 물어보면 내 데이터를 찾아보고 답합니다. AI 비용 관리를 위해 가입한 분께만 제공합니다."
          next="/ai"
        />
      </div>
    );
  }
  const cid = wanted && convs.some((c) => c.id === wanted) ? wanted : null;
  const initial: ChatMsg[] = (cid ? rows : []).map((r) => ({ role: r.role, text: r.content.text, tools: r.content.tools?.map((t) => t.name) }));
  const ai = await aiStatus(user.id);
  const enabled = ai.enabled;

  return (
    <div>
      <Tabs
        active={view}
        items={[
          { key: "chat", label: "질문하기", href: "/ai" },
          { key: "reports", label: "리포트", href: "/ai?view=reports" },
        ]}
      />
      {!enabled ? (
        <div className="mb-3">
          <AiSetupNotice problem={ai.problem} />
        </div>
      ) : ai.problem ? (
        <div className="mb-3">
          <AiSetupNotice problem={`${ai.problem} 지금은 서버 기본 모델을 씁니다.`} />
        </div>
      ) : null}
      {enabled ? (
        <p className="mb-2 text-xs text-muted">
          사용 모델: {ai.label}
          {ai.ownKey ? " (내 키)" : " (서버 기본)"} ·{" "}
          <Link href="/settings#ai" className="text-accent">
            변경
          </Link>
        </p>
      ) : null}
      {view === "reports" ? (
        <ReportsPanel userId={user.id} enabled={enabled} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
          <Card className="hidden h-fit p-2 lg:block">
            <Link href="/ai" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-accent hover:bg-surface-2">
              <MessageSquarePlus size={16} /> 새 대화
            </Link>
            <ul className="mt-1">
              {convs.map((c) => (
                <li key={c.id}>
                  <Link href={`/ai?c=${c.id}`} className={`block truncate rounded-lg px-2 py-1.5 text-sm ${c.id === cid ? "bg-accent-soft text-accent" : "hover:bg-surface-2"}`}>
                    {c.title ?? "대화"}
                    <span className="block text-[11px] text-muted">{formatDate(c.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex h-[calc(100dvh-12rem)] min-h-[420px] flex-col lg:h-[calc(100dvh-9rem)]">
            {cid ? (
              <Link href="/ai" className="mb-2 inline-flex items-center gap-1 text-sm text-accent lg:hidden">
                <MessageSquarePlus size={14} /> 새 대화
              </Link>
            ) : convs.length ? (
              <div className="mb-2 flex gap-1.5 overflow-x-auto lg:hidden">
                {convs.slice(0, 6).map((c) => (
                  <Link key={c.id} href={`/ai?c=${c.id}`} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
                    <FileText size={12} /> {(c.title ?? "대화").slice(0, 14)}
                  </Link>
                ))}
              </div>
            ) : null}
            <Chat key={cid ?? "new"} conversationId={cid} initial={initial} enabled={enabled} />
          </div>
        </div>
      )}
    </div>
  );
}
