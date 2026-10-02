import clsx from "clsx";
import { Bot, ChevronLeft, Pencil, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { AttachmentCards } from "@/components/community/attachments";
import { CommentForm, LikeButton, PollCard, ReplyToggle, ReportButton } from "@/components/community/interactive";
import { AuthorLine, CategoryBadge, PostList, PostText } from "@/components/community/parts";
import { Badge, Card, CardHeader, Notice } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { canWrite, type CommentRow, communityMe, getPoll, getPost, listComments, listPosts, shortSgg } from "@/lib/community/queries";
import { REPORT_REASONS } from "@/lib/community/rules";
import { moderateAction } from "../../moderate-actions";
import { deleteCommentAction, deletePostAction } from "../../actions";

export async function generateMetadata(props: PageProps<"/community/posts/[id]">): Promise<Metadata> {
  const id = Number((await props.params).id);
  const [p] = Number.isSafeInteger(id) ? await sql<{ title: string }[]>`select title from community_posts where id = ${id} and status = 'visible'` : [];
  return { title: p?.title ?? "동네 이야기" };
}

export default async function PostPage(props: PageProps<"/community/posts/[id]">) {
  const [{ id: raw }, user] = await Promise.all([props.params, requireUser()]);
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) notFound();
  const [post, comments, poll, me, unit] = await Promise.all([
    getPost(id, user.id, user.isAdmin),
    listComments(id, user.id, user.isAdmin),
    getPoll(id, user.id),
    communityMe(user.id, user.isAdmin),
    getAreaUnit(),
  ]);
  if (!post) notFound();
  if (!post.mine) after(() => sql`update community_posts set view_count = view_count + 1 where id = ${id}`.then(() => undefined));
  const related = await listPosts({ uid: user.id, sgg: post.complex_id ? null : post.sgg_cd, complexId: post.complex_id, excludeComplex: null, sort: "hot", limit: 6 });
  const top = comments.filter((c) => !c.parent_id);
  const replies = (pid: number) => comments.filter((c) => c.parent_id === pid);
  const boardHref = post.complex_id ? `/community?complex=${post.complex_id}` : `/community?sgg=${post.sgg_cd}`;
  const reports = user.isAdmin && post.report_count
    ? await sql<{ reason: string; n: number }[]>`select reason, count(*)::int as n from community_reports where target_type = 'post' and target_id = ${id} group by reason`
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={boardHref} className="inline-flex items-center gap-0.5 text-sm text-muted hover:text-accent">
        <ChevronLeft size={16} />
        {post.complex_name ? `${post.complex_name} 이야기` : `${shortSgg(post.sgg_name)} 이야기`}
      </Link>

      {post.status === "held" ? (
        <Notice tone="warn">
          <b>검토 중</b> — 운영 원칙 점검에 걸린 표현이 있어 확인 후 공개됩니다(지금은 나{user.isAdmin ? "와 운영자" : ""}만 볼 수 있음).
          {post.moderation.flags?.length ? <> 점검 항목: {post.moderation.flags.map((f) => f.label).join(", ")}</> : null}
          {post.moderation.ai?.reason ? <> · AI: {post.moderation.ai.reason}</> : null}
        </Notice>
      ) : null}
      {post.status === "hidden" ? <Notice tone="warn">운영 원칙 위반으로 가려진 글입니다(운영자에게만 보임). {post.moderation.ai?.reason ?? ""}</Notice> : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryBadge category={post.category} />
          {post.complex_name ? <Link href={`/complexes/${post.complex_id}`} className="text-xs text-muted hover:text-accent">{post.complex_name}</Link> : null}
          <Link href={`/community?sgg=${post.sgg_cd}`} className="text-xs text-muted hover:text-accent">{shortSgg(post.sgg_name)}</Link>
        </div>
        <h1 className="mt-2 text-lg font-bold leading-snug md:text-xl">{post.title}</h1>
        <AuthorLine author={post.author} at={post.created_at} edited={post.edited_at} className="mt-1.5" />
        {post.kind === "system" ? <p className="mt-1 text-[11px] text-muted">실거래·청약 데이터로 자동 작성된 글입니다. 이 소식에 대한 생각을 댓글로 나눠 보세요.</p> : null}

        {post.body ? <PostText text={post.body} className="mt-4" /> : null}
        <div className="mt-4 space-y-3">
          <AttachmentCards attachments={post.attachments} unit={unit} />
          {poll ? <PollCard postId={post.id} poll={poll} /> : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <LikeButton target="post" id={post.id} liked={post.liked} count={post.like_count} disabled={post.status !== "visible"} />
          <span className="text-xs text-muted">조회 {post.view_count}</span>
          <span className="ml-auto flex items-center gap-3">
            {post.mine && post.kind === "user" && post.status !== "hidden" ? (
              <Link href={`/community/posts/${post.id}/edit`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"><Pencil size={12} />수정</Link>
            ) : null}
            {post.mine || user.isAdmin ? (
              <form action={deletePostAction.bind(null, post.id)}>
                <button className="inline-flex items-center gap-1 text-xs text-muted hover:text-up"><Trash2 size={12} />삭제</button>
              </form>
            ) : null}
            {!post.mine && post.kind === "user" ? <ReportButton target="post" id={post.id} reported={post.reported} /> : null}
          </span>
        </div>

        {user.isAdmin ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-2 text-xs">
            <Badge tone="warn">운영</Badge>
            <span className="text-muted">상태 {post.status} · 신고 {post.report_count}{reports.length ? ` (${reports.map((r) => `${REPORT_REASONS[r.reason as keyof typeof REPORT_REASONS] ?? r.reason} ${r.n}`).join(", ")})` : ""}</span>
            {post.status !== "visible" ? <AdminBtn target="post" id={post.id} op="restore">공개</AdminBtn> : null}
            {post.status !== "hidden" ? <AdminBtn target="post" id={post.id} op="hide">가리기</AdminBtn> : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title={`댓글 ${comments.filter((c) => c.status === "visible").length}`} />
        <ul className="divide-y divide-border">
          {top.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <Comment c={c} postId={post.id} canReply={canWrite(me) && post.status === "visible"} isAdmin={user.isAdmin} />
              {replies(c.id).length ? (
                <ul className="mt-2 space-y-2 border-l-2 border-border pl-3">
                  {replies(c.id).map((r) => (
                    <li key={r.id}><Comment c={r} postId={post.id} canReply={false} isAdmin={user.isAdmin} /></li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
          {!top.length ? <li className="px-4 py-4 text-sm text-muted">첫 댓글을 남겨 보세요.</li> : null}
        </ul>
        <div className="border-t border-border p-4">
          {post.status !== "visible" ? (
            <p className="text-sm text-muted">공개된 글에만 댓글을 달 수 있습니다.</p>
          ) : canWrite(me) ? (
            me.mutedUntil ? <p className="text-sm text-up">{me.mutedUntil.slice(0, 10)}까지 댓글 작성이 제한되었습니다.</p> : <CommentForm postId={post.id} />
          ) : (
            <p className="text-sm text-muted">
              댓글을 쓰려면 <Link href={`/community/profile?next=${encodeURIComponent(`/community/posts/${post.id}`)}`} className="text-accent underline">닉네임을 정하세요</Link>.
            </p>
          )}
        </div>
      </Card>

      {related.filter((r) => r.id !== post.id).length ? (
        <Card className="overflow-hidden">
          <CardHeader title="이 게시판 인기글" action={<Link href={boardHref} className="text-accent">전체</Link>} />
          <PostList posts={related.filter((r) => r.id !== post.id).slice(0, 5)} showBoard={false} />
        </Card>
      ) : null}
    </div>
  );
}

function Comment({ c, postId, canReply, isAdmin }: { c: CommentRow; postId: number; canReply: boolean; isAdmin: boolean }) {
  if (c.status === "deleted") return <p id={`c${c.id}`} className="text-sm text-muted">삭제된 댓글입니다.</p>;
  return (
    <div id={`c${c.id}`} className={clsx(c.kind === "ai" && "rounded-lg bg-accent-soft/40 p-3")}>
      <AuthorLine author={c.author} at={c.created_at} />
      {c.status === "held" ? <Badge tone="warn" className="mt-1">검토 중</Badge> : null}
      {c.status === "hidden" ? <Badge tone="warn" className="mt-1">가려짐</Badge> : null}
      <PostText text={c.body} className="mt-1 text-sm" />
      {c.kind === "ai" ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted"><Bot size={11} />앱의 실거래·지표 데이터로 AI가 작성한 답변입니다. 생활 정보는 이웃의 답을 참고하세요.</p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {c.kind === "user" ? <LikeButton target="comment" id={c.id} liked={c.liked} count={c.like_count} disabled={c.status !== "visible"} /> : null}
        {canReply ? <ReplyToggle postId={postId} parentId={c.id} nickname={c.author.nickname} /> : null}
        <span className="ml-auto flex items-center gap-3">
          {c.mine || isAdmin ? (
            <form action={deleteCommentAction.bind(null, c.id)}><button className="text-xs text-muted hover:text-up">삭제</button></form>
          ) : null}
          {!c.mine && c.kind === "user" ? <ReportButton target="comment" id={c.id} reported={c.reported} /> : null}
          {isAdmin && c.status !== "visible" ? <AdminBtn target="comment" id={c.id} op="restore">공개</AdminBtn> : null}
          {isAdmin && c.status === "visible" ? <AdminBtn target="comment" id={c.id} op="hide">가리기</AdminBtn> : null}
        </span>
      </div>
    </div>
  );
}

function AdminBtn({ target, id, op, children }: { target: "post" | "comment"; id: number; op: "hide" | "restore"; children: React.ReactNode }) {
  return (
    <form action={moderateAction.bind(null, target, id, op)}>
      <button className={clsx("rounded px-2 py-0.5 text-xs", op === "hide" ? "bg-up/10 text-up" : "bg-ok/10 text-ok")}>{children}</button>
    </form>
  );
}
