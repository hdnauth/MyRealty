import { FileText, MessageSquarePlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Chat, type ChatMsg } from "@/components/ai/chat";
import { Card, Notice, Tabs } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/client";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { ReportsPanel } from "./reports-panel";

export const metadata: Metadata = { title: "AI" };

export default async function AiPage(props: PageProps<"/ai">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const view = sp.view === "reports" ? "reports" : "chat";
  const convs = await sql<{ id: string; title: string | null; updated_at: string }[]>`
    select id, title, updated_at::text from ai_conversations where user_id = ${user.id} order by updated_at desc limit 30`;
  const cid = typeof sp.c === "string" && convs.some((c) => c.id === sp.c) ? sp.c : null;
  const rows = cid
    ? await sql<{ role: "user" | "assistant"; content: { text: string; tools?: { name: string }[] } }[]>`
        select role, content from ai_messages where conversation_id = ${cid} order by id`
    : [];
  const initial: ChatMsg[] = rows.map((r) => ({ role: r.role, text: r.content.text, tools: r.content.tools?.map((t) => t.name) }));
  const enabled = aiEnabled();

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
          <Notice tone="warn">ANTHROPIC_API_KEY 가 설정되지 않아 AI 기능이 비활성 상태입니다. .env 에 키를 넣고 다시 시작하세요.</Notice>
        </div>
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
