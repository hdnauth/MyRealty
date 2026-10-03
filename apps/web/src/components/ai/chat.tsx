"use client";

import { ArrowUp, Loader2, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "./markdown";
import { AiReportButton } from "./report-button";

export type ChatMsg = { role: "user" | "assistant"; text: string; tools?: string[] };

const TOOL_LABEL: Record<string, string> = {
  list_watch_items: "관심 부동산 목록",
  get_item_detail: "부동산 상세",
  query_transactions: "실거래 조회",
  similar_complexes: "유사 단지",
  get_indicators: "지표",
  search_news: "뉴스",
  list_events: "일정",
  get_location: "입지",
  simulate_loan: "대출 계산",
};

const SUGGESTIONS = [
  "관심 부동산의 최근 1년 시세 흐름을 주변과 비교해줘",
  "지금 우리 동네 매수 여건을 지표로 설명해줘",
  "금리가 1%p 오르면 내 대출 월 상환액은?",
  "관심 부동산 관련 최근 뉴스 중 중요한 것만 요약해줘",
  "매수 후보들의 입지와 가격을 표로 비교해줘",
];

export function Chat({ conversationId, initial, enabled }: { conversationId: string | null; initial: ChatMsg[]; enabled: boolean }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<ChatMsg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const convRef = useRef(conversationId);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setErr(null);
    setBusy(true);
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }, { role: "assistant", text: "", tools: [] }]);
    const update = (fn: (a: ChatMsg) => ChatMsg) => setMsgs((m) => [...m.slice(0, -1), fn(m[m.length - 1])]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: convRef.current ?? undefined, message: text }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const ev = /^event: (.+)$/m.exec(part)?.[1];
          const data = JSON.parse(/^data: (.+)$/m.exec(part)?.[1] ?? "{}");
          if (ev === "meta" && !convRef.current) convRef.current = data.conversationId;
          else if (ev === "text") update((a) => ({ ...a, text: a.text + data.delta }));
          else if (ev === "tool") update((a) => ({ ...a, tools: [...(a.tools ?? []), data.name] }));
          else if (ev === "error") setErr(data.message);
        }
      }
      if (!conversationId && convRef.current) router.replace(`/ai?c=${convRef.current}`, { scroll: false });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        {msgs.length === 0 ? (
          <div className="space-y-3 py-6">
            <p className="text-sm text-muted">관심 부동산·실거래·지표·뉴스·입지 데이터를 조회해 답합니다. 수치는 모두 조회 결과에서 인용합니다.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" disabled={!enabled} onClick={() => send(s)} className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-sm hover:border-accent disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-white">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="max-w-full">
              {m.tools?.length ? (
                <div className="mb-1 flex flex-wrap gap-1">
                  {m.tools.map((t, j) => (
                    <span key={j} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.75rem] text-muted">
                      <Wrench size={11} /> {TOOL_LABEL[t] ?? t}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="card px-4 py-3">
                {m.text ? <Markdown>{m.text.trim()}</Markdown> : <span className="inline-flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> 데이터를 조회하며 생각하는 중…</span>}
              </div>
              {m.text && !(busy && i === msgs.length - 1) ? (
                <div className="mt-1 px-1">
                  <AiReportButton surface="chat" refId={convRef.current} excerpt={m.text} />
                </div>
              ) : null}
            </div>
          ),
        )}
        {err ? <p className="text-sm text-up">{err}</p> : null}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2 border-t border-border pt-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          disabled={!enabled}
          placeholder={enabled ? "무엇이든 물어보세요" : "AI 키 설정 필요"}
          className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy || !enabled || !input.trim()} aria-label="보내기" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white disabled:opacity-40">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
        </button>
      </form>
    </div>
  );
}
