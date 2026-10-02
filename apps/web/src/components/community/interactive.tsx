"use client";

import clsx from "clsx";
import { Ban, Bell, BellOff, Flag, Heart, Sparkles } from "lucide-react";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import {
  blockUserAction,
  createCommentAction,
  followAction,
  type FormState,
  reportAction,
  summaryAction,
  toggleLikeAction,
  voteAction,
} from "@/app/(main)/community/actions";
import { Button, Select, Textarea } from "@/components/ui";
import { REPORT_REASONS } from "@/lib/community/rules";

export function LikeButton({ target, id, liked, count, disabled }: { target: "post" | "comment"; id: number; liked: boolean; count: number; disabled?: boolean }) {
  const [state, setState] = useState({ liked, count });
  const [optimistic, setOptimistic] = useOptimistic(state);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-pressed={optimistic.liked}
      onClick={() =>
        start(async () => {
          setOptimistic({ liked: !optimistic.liked, count: optimistic.count + (optimistic.liked ? -1 : 1) });
          const r = await toggleLikeAction(target, id);
          if ("error" in r) setError(r.error);
          else setState(r);
        })
      }
      title={error ?? "좋아요"}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        optimistic.liked ? "border-up/40 bg-up/10 text-up" : "border-border text-muted hover:text-text",
      )}
    >
      <Heart size={13} fill={optimistic.liked ? "currentColor" : "none"} />
      {optimistic.count}
    </button>
  );
}

export function ReportButton({ target, id, reported }: { target: "post" | "comment"; id: number; reported: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(reportAction.bind(null, target, id), {} as FormState);
  if (reported || state.ok) return <span className="text-xs text-muted">{state.ok ?? "신고함"}</span>;
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-up">
        <Flag size={12} />
        신고
      </button>
      {open ? (
        <form action={action} className="absolute right-0 z-20 mt-1 w-64 space-y-2 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <p className="text-xs font-medium">신고 사유</p>
          <Select name="reason" defaultValue="" required className="h-9 text-sm">
            <option value="" disabled>선택</option>
            {Object.entries(REPORT_REASONS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
          <Textarea name="detail" rows={2} maxLength={500} placeholder="자세한 내용(선택)" className="text-sm" />
          {state.error ? <p className="text-xs text-up">{state.error}</p> : null}
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen(false)}>취소</Button>
            <Button type="submit" variant="danger" className="h-8 px-3 text-xs" disabled={pending}>신고</Button>
          </div>
        </form>
      ) : null}
    </span>
  );
}

/** 사용자 차단·해제. 차단하면 그 사용자의 글·댓글이 보이지 않는다(상대에게 알리지 않음) */
export function BlockButton({ userId, nickname, blocked = false }: { userId: string; nickname: string; blocked?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <button
      type="button"
      disabled={pending}
      title={msg ?? undefined}
      onClick={() => {
        if (!blocked && !window.confirm(`${nickname}님을 차단할까요? 이 사용자의 글과 댓글이 보이지 않고 댓글 알림도 오지 않습니다. 설정 → 동네 이야기 내 활동에서 풀 수 있습니다.`)) return;
        start(async () => {
          const r = await blockUserAction(userId, !blocked);
          setMsg(r.error ?? r.ok ?? null);
          if (r.error) window.alert(r.error);
        });
      }}
      className="inline-flex items-center gap-1 text-xs text-muted hover:text-up"
    >
      <Ban size={12} />
      {blocked ? "차단 해제" : "차단"}
    </button>
  );
}

export function CommentForm({ postId, parentId = null, placeholder, autoFocus, onDone }: { postId: number; parentId?: number | null; placeholder?: string; autoFocus?: boolean; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (s: FormState, f: FormData) => {
    const r = await createCommentAction(postId, parentId, s, f);
    if (r.ok && onDone) onDone();
    return r;
  }, {} as FormState);
  const [key, setKey] = useState(0);
  return (
    <form
      key={key}
      action={async (f) => {
        await action(f);
        setKey((k) => k + 1);
      }}
      className="space-y-1.5"
    >
      <Textarea name="body" rows={parentId ? 2 : 3} maxLength={1000} required autoFocus={autoFocus} placeholder={placeholder ?? "댓글을 남겨 주세요. 근거와 함께 쓰면 더 도움이 됩니다."} className="text-sm" />
      <div className="flex items-center justify-between gap-2">
        <span className={clsx("text-xs", state.error ? "text-up" : "text-muted")}>{state.error ?? state.ok ?? "동·호수·연락처는 자동으로 가려집니다."}</span>
        <Button type="submit" className="h-8 px-3 text-xs" disabled={pending}>{parentId ? "답글" : "댓글"} 등록</Button>
      </div>
    </form>
  );
}

export function ReplyToggle({ postId, parentId, nickname }: { postId: number; parentId: number; nickname: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-muted hover:text-accent">답글</button>
      {open ? (
        <div className="mt-2 basis-full">
          <CommentForm postId={postId} parentId={parentId} placeholder={`${nickname}님에게 답글`} autoFocus onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}

export function PollCard({
  postId,
  poll,
}: {
  postId: number;
  poll: { kind: string; question: string; options: string[]; counts: number[]; total: number; myVote: number | null; closed: boolean; closes_at: string | null };
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const showResult = poll.myVote !== null || poll.closed;
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-sm font-semibold">{poll.question}</p>
      <p className="mt-0.5 text-xs text-muted">
        {poll.total}명 참여 · {poll.closed ? "마감" : poll.closes_at ? `${poll.closes_at.slice(0, 10)} 마감` : "진행 중"}
        {poll.kind === "outlook" ? " · 지표 화면의 커뮤니티 심리에 반영됩니다" : ""}
      </p>
      <ul className="mt-2 space-y-1.5">
        {poll.options.map((o, i) => {
          const pct = poll.total ? Math.round((poll.counts[i] / poll.total) * 100) : 0;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={pending || poll.closed}
                onClick={() =>
                  start(async () => {
                    const r = await voteAction(postId, i);
                    setError(r.error ?? null);
                  })
                }
                className={clsx(
                  "relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm",
                  poll.myVote === i ? "border-accent" : "border-border hover:border-accent/50",
                )}
              >
                {showResult ? <span className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${pct}%` }} /> : null}
                <span className="relative flex justify-between gap-2">
                  <span className={clsx(poll.myVote === i && "font-semibold text-accent")}>{o}</span>
                  {showResult ? <span className="tabular text-muted">{pct}% · {poll.counts[i]}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-1 text-xs text-up">{error}</p> : !showResult ? <p className="mt-1 text-xs text-muted">투표하면 결과가 보입니다. 다시 눌러 바꿀 수 있습니다.</p> : null}
    </div>
  );
}

export function FollowButton({ scope, id, following, auto }: { scope: "sgg" | "complex"; id: string; following: boolean; auto: boolean }) {
  const [pending, start] = useTransition();
  if (auto) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent" title="관심 부동산이 있어 자동으로 구독됩니다">
        <Bell size={12} /> 자동 구독
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => followAction(scope, id, !following))}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        following ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text",
      )}
    >
      {following ? <Bell size={12} /> : <BellOff size={12} />}
      {following ? "구독 중" : "구독"}
    </button>
  );
}

export function SummaryButton({ scope, id, label }: { scope: "complex_faq" | "sgg_week"; id: string; label: string }) {
  const [state, action, pending] = useActionState(summaryAction.bind(null, scope, id), {} as FormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="secondary" className="h-8 px-3 text-xs" disabled={pending}>
        <Sparkles size={13} />
        {pending ? "만드는 중…" : label}
      </Button>
      {state.error ? <span className="text-xs text-up">{state.error}</span> : state.ok ? <span className="text-xs text-muted">{state.ok}</span> : null}
    </form>
  );
}
