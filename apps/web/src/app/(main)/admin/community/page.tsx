import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { REPORT_REASONS } from "@/lib/community/rules";
import { dismissReportsAction, moderateAction, muteUserAction } from "../../community/moderate-actions";

export const metadata: Metadata = { title: "관리 · 커뮤니티" };

type QueueRow = {
  target: "post" | "comment";
  id: number;
  post_id: number;
  title: string | null;
  body: string;
  status: string;
  moderation: { flags?: { label: string }[]; ai?: { verdict: string; reason?: string }; auto_hidden?: string };
  user_id: string | null;
  nickname: string | null;
  email: string | null;
  created_at: string;
  reports: number;
  reasons: string[] | null;
  muted: boolean;
};

export default async function AdminCommunityPage() {
  await requireAdmin();
  const [[stats], queue, muted] = await Promise.all([
    sql<{ posts: number; comments: number; open: number; held: number; hidden: number; users: number; ai_cost: number }[]>`
      select (select count(*)::int from community_posts where created_at > now() - interval '7 days' and kind = 'user') as posts,
             (select count(*)::int from community_comments where created_at > now() - interval '7 days' and kind = 'user') as comments,
             (select count(*)::int from community_reports where status = 'open') as open,
             (select count(*)::int from community_posts where status = 'held') + (select count(*)::int from community_comments where status = 'held') as held,
             (select count(*)::int from community_posts where status = 'hidden') + (select count(*)::int from community_comments where status = 'hidden') as hidden,
             (select count(*)::int from users where nickname is not null) as users,
             (select coalesce(sum(cost_usd), 0)::float8 from ai_usage where purpose like 'community%' and created_at >= date_trunc('month', now())) as ai_cost`,
    // 확인할 것: 열린 신고가 있거나 보류(held)·자동 가림 상태인 글·댓글
    sql<QueueRow[]>`
      with targets as (
        select 'post'::text as target, p.id, p.id as post_id, p.title, p.body, p.status, p.moderation, p.user_id, p.created_at
        from community_posts p
        where p.status = 'held' or (p.status = 'hidden' and p.moderation ? 'auto_hidden' and not p.moderation ? 'by')
           or exists (select 1 from community_reports r where r.target_type = 'post' and r.target_id = p.id and r.status = 'open')
        union all
        select 'comment', m.id, m.post_id, null, m.body, m.status, m.moderation, m.user_id, m.created_at
        from community_comments m
        where m.status = 'held' or (m.status = 'hidden' and m.moderation ? 'auto_hidden' and not m.moderation ? 'by')
           or exists (select 1 from community_reports r where r.target_type = 'comment' and r.target_id = m.id and r.status = 'open')
      )
      select t.target, t.id, t.post_id, t.title, left(t.body, 400) as body, t.status, t.moderation, t.user_id, u.nickname, u.email,
             t.created_at::text, coalesce(u.community_muted_until > now(), false) as muted,
             (select count(*)::int from community_reports r where r.target_type = t.target and r.target_id = t.id and r.status = 'open') as reports,
             (select array_agg(distinct r.reason) from community_reports r where r.target_type = t.target and r.target_id = t.id and r.status = 'open') as reasons
      from targets t left join users u on u.id = t.user_id
      order by reports desc, t.created_at desc limit 100`,
    sql<{ id: string; nickname: string | null; email: string; until: string }[]>`
      select id, nickname, email, community_muted_until::text as until from users where community_muted_until > now() order by community_muted_until desc`,
  ]);

  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="7일 글 / 댓글" value={`${stats.posts} / ${stats.comments}`} />
        <Stat label="열린 신고" value={stats.open} sub={stats.open ? <span className="text-up">확인 필요</span> : null} />
        <Stat label="보류 / 가림" value={`${stats.held} / ${stats.hidden}`} />
        <Stat label="닉네임 사용자" value={stats.users} sub={<span className="text-muted">이번 달 AI ${stats.ai_cost.toFixed(2)}</span>} />
      </Card>

      <Card>
        <CardHeader title="처리 대기" sub="열린 신고, 자동 점검 보류, 신고 누적 자동 가림. 처리하면 작성자에게 알림이 갑니다." />
        {queue.length ? (
          <ul className="divide-y divide-border">
            {queue.map((q) => (
              <li key={`${q.target}${q.id}`} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Badge>{q.target === "post" ? "글" : "댓글"}</Badge>
                  <Badge tone={q.status === "visible" ? "ok" : "warn"}>{q.status === "held" ? "보류" : q.status === "hidden" ? "가림" : "공개"}</Badge>
                  {q.reports ? <Badge tone="up">신고 {q.reports}</Badge> : null}
                  {q.reasons?.map((r) => <span key={r}>{REPORT_REASONS[r as keyof typeof REPORT_REASONS] ?? r}</span>)}
                  <span>· {q.nickname ?? "탈퇴"} ({q.email ?? "-"}) · {timeAgo(q.created_at)}</span>
                  {q.muted ? <Badge tone="warn">작성 제한 중</Badge> : null}
                </div>
                <Link href={`/community/posts/${q.post_id}${q.target === "comment" ? `#c${q.id}` : ""}`} className="block hover:text-accent">
                  {q.title ? <p className="font-semibold">{q.title}</p> : null}
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted">{q.body}</p>
                </Link>
                {q.moderation.flags?.length || q.moderation.ai ? (
                  <p className="text-xs text-muted">
                    {q.moderation.flags?.length ? <>규칙: {q.moderation.flags.map((f) => f.label).join(", ")} </> : null}
                    {q.moderation.ai ? <>· AI {q.moderation.ai.verdict}: {q.moderation.ai.reason}</> : null}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  {q.status !== "visible" ? <Act action={moderateAction.bind(null, q.target, q.id, "restore")} tone="ok">공개</Act> : null}
                  {q.status !== "hidden" ? <Act action={moderateAction.bind(null, q.target, q.id, "hide")} tone="up">가리기</Act> : null}
                  {q.reports ? <Act action={dismissReportsAction.bind(null, q.target, q.id)}>신고 기각</Act> : null}
                  {q.user_id && !q.muted ? (
                    <>
                      <Act action={muteUserAction.bind(null, q.user_id, 7)} tone="up">작성 제한 7일</Act>
                      <Act action={muteUserAction.bind(null, q.user_id, 30)} tone="up">30일</Act>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-sm text-muted">처리할 항목이 없습니다.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="작성 제한 중인 사용자" />
        {muted.length ? (
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {muted.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/admin/users/${m.id}`} className="hover:text-accent">{m.nickname ?? "-"} <span className="text-muted">({m.email}) · {m.until.slice(0, 10)}까지</span></Link>
                <Act action={muteUserAction.bind(null, m.id, 0)}>해제</Act>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-sm text-muted">없습니다.</p>
        )}
      </Card>
    </div>
  );
}

function Act({ action, tone, children }: { action: () => Promise<void>; tone?: "ok" | "up"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "bg-ok/10 text-ok" : tone === "up" ? "bg-up/10 text-up" : "bg-surface-2 text-text";
  return (
    <form action={action}>
      <button className={`rounded-md px-2.5 py-1 text-xs font-medium ${cls}`}>{children}</button>
    </form>
  );
}
