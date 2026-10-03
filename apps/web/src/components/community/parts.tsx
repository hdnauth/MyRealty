import clsx from "clsx";
import { BarChart3, Bot, CheckCircle2, Eye, Heart, Home, ImageIcon, MessageCircle, Paperclip, Star } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { Author, Badge as AuthorBadge, PostRow } from "@/lib/community/queries";
import { shortSgg } from "@/lib/community/queries";
import { CATEGORIES, isCategory } from "@/lib/community/rules";

export function CategoryBadge({ category }: { category: string }) {
  const c = isCategory(category) ? CATEGORIES[category] : { label: category, tone: "neutral" as const };
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

const BADGE: Record<AuthorBadge, { label: string; title: string; icon: typeof Home; cls: string }> = {
  resident: { label: "거주 인증", title: "이 단지 근처에서 여러 날 위치를 확인한 사용자", icon: CheckCircle2, cls: "text-ok" },
  owner: { label: "보유", title: "이 단지(지역)를 보유 부동산으로 등록한 사용자(본인 표시)", icon: Home, cls: "text-accent" },
  watcher: { label: "관심", title: "이 단지(지역)를 관심 부동산으로 등록한 사용자", icon: Star, cls: "text-muted" },
};

export function AuthorLine({ author, at, edited, className }: { author: Author; at: string; edited?: string | null; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted", className)}>
      {author.isAi ? <Bot size={13} className="text-accent" /> : null}
      <span className={clsx("font-medium", author.isAi ? "text-accent" : "text-text")}>{author.nickname}</span>
      {author.level ? <span className="rounded bg-surface-2 px-1 text-[0.75rem]">{author.level}</span> : null}
      {author.badges.map((b) => {
        const x = BADGE[b];
        const Icon = x.icon;
        return (
          <span key={b} title={x.title} className={clsx("inline-flex items-center gap-0.5 text-[0.75rem]", x.cls)}>
            <Icon size={12} />
            {x.label}
          </span>
        );
      })}
      <span>· {timeAgo(at)}</span>
      {edited ? <span>(수정됨)</span> : null}
    </div>
  );
}

/** 글 목록 한 줄 */
export function PostItem({ p, showBoard = true }: { p: PostRow; showBoard?: boolean }) {
  return (
    <li>
      <Link href={`/community/posts/${p.id}`} className="block px-4 py-3 hover:bg-surface-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[0.75rem] text-muted">
          <CategoryBadge category={p.category} />
          {p.status === "held" ? <Badge tone="warn">검토 중</Badge> : null}
          {showBoard ? <span className="truncate">{p.complex_name ?? shortSgg(p.sgg_name)}</span> : null}
        </div>
        <p className="mt-1 line-clamp-1 text-sm font-semibold leading-snug">
          {p.title}
          {p.has_poll ? <BarChart3 size={14} className="ml-1 inline text-accent" aria-label="투표" /> : null}
          {p.image_count ? <ImageIcon size={14} className="ml-1 inline text-muted" aria-label="사진" /> : null}
          {p.attach_count > p.image_count ? <Paperclip size={13} className="ml-1 inline text-muted" aria-label="데이터 첨부" /> : null}
        </p>
        {p.excerpt ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{p.excerpt}</p> : null}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <AuthorLine author={p.author} at={p.created_at} />
          <span className="flex shrink-0 items-center gap-2.5 text-xs text-muted">
            <span className={clsx("flex items-center gap-0.5", p.liked && "text-up")}><Heart size={12} />{p.like_count}</span>
            <span className="flex items-center gap-0.5"><MessageCircle size={12} />{p.comment_count}</span>
            <span className="hidden items-center gap-0.5 sm:flex"><Eye size={12} />{p.view_count}</span>
          </span>
        </div>
      </Link>
    </li>
  );
}

export function PostList({ posts, showBoard = true, empty }: { posts: PostRow[]; showBoard?: boolean; empty?: React.ReactNode }) {
  if (!posts.length) return <div className="px-4 py-8 text-center text-sm text-muted">{empty ?? "아직 글이 없습니다."}</div>;
  return (
    <ul className="divide-y divide-border">
      {posts.map((p) => (
        <PostItem key={p.id} p={p} showBoard={showBoard} />
      ))}
    </ul>
  );
}

/** 본문: 일반 텍스트(줄바꿈 유지), 링크만 새 탭으로 */
export function PostText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <div className={clsx("whitespace-pre-wrap break-words text-sm leading-relaxed", className)}>
      {parts.map((s, i) =>
        /^https?:\/\//.test(s) ? (
          <a key={i} href={s} target="_blank" rel="noreferrer nofollow ugc" className="text-accent underline">
            {s}
          </a>
        ) : (
          s
        ),
      )}
    </div>
  );
}
