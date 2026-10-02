import { Building2, LineChart, PenSquare, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Markdown } from "@/components/ai/markdown";
import { FollowButton, SummaryButton } from "@/components/community/interactive";
import { PostList } from "@/components/community/parts";
import { Card, CardHeader, Input, LinkButton, Notice, PageHeader } from "@/components/ui";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { canWrite, communityMe, getSummary, isFollowing, listPosts, shortSgg, sggNames, subscriptions } from "@/lib/community/queries";
import { CATEGORIES, isCategory, isSgg } from "@/lib/community/rules";

export const metadata: Metadata = { title: "동네 이야기" };

const PAGE = 20;

export default async function CommunityPage(props: PageProps<"/community">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  const user = await requireUser();
  const [me, subs] = await Promise.all([communityMe(uid, user.isAdmin), subscriptions(uid)]);

  const sgg = isSgg(sp.sgg) ? sp.sgg : null;
  const complexId = typeof sp.complex === "string" && /^\d+$/.test(sp.complex) ? Number(sp.complex) : null;
  const category = isCategory(sp.cat) ? sp.cat : null;
  const sort = sp.sort === "hot" ? "hot" : "new";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 50) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const feed = !sgg && !complexId;
  const hasSubs = subs.sggs.length > 0 || subs.complexes.length > 0;

  const [complex] = complexId
    ? await sql<{ id: number; name: string; sgg: string; umd_nm: string | null }[]>`select id, name, sgg_cd as sgg, umd_nm from complexes where id = ${complexId}`
    : [];
  const boardSgg = complex?.sgg ?? sgg;
  const [names, following] = await Promise.all([
    sggNames(boardSgg ? [boardSgg] : []),
    complexId ? isFollowing(uid, "complex", String(complexId)) : sgg ? isFollowing(uid, "sgg", sgg) : Promise.resolve(false),
  ]);
  const sggName = boardSgg ? (names[boardSgg] ?? boardSgg) : null;

  const base = { uid, category, sort, q, limit: PAGE + 1, offset: (page - 1) * PAGE } as const;
  const [rows, rollup, summary, popular] = await Promise.all([
    listPosts({
      ...base,
      sgg: complexId ? null : sgg,
      complexId,
      feed: feed && hasSubs ? { sggs: subs.sggs.map((s) => s.sgg), complexIds: subs.complexes.map((c) => c.id) } : null,
    }),
    // 단지 게시판: 같은 시군구의 인기글을 함께(빈 게시판 완화)
    complex && page === 1 && !q ? listPosts({ uid, sgg: complex.sgg, excludeComplex: complex.id, sort: "hot", limit: 5 }) : Promise.resolve([]),
    complexId ? getSummary("complex_faq", String(complexId)) : sgg ? getSummary("sgg_week", sgg) : Promise.resolve(null),
    // 구독이 없으면 활발한 게시판을 보여 준다
    feed && !hasSubs
      ? sql<{ sgg: string; n: number }[]>`
          select sgg_cd as sgg, count(*)::int as n from community_posts where status = 'visible' and created_at > now() - interval '30 days'
          group by sgg_cd order by n desc limit 8`
      : Promise.resolve([]),
  ]);
  const popularNames = await sggNames(popular.map((p) => p.sgg));
  const posts = rows.slice(0, PAGE);
  const more = rows.length > PAGE;

  const qs = (o: Record<string, string | number | null>) => {
    const u = new URLSearchParams();
    const merged = { sgg, complex: complexId, cat: category, sort: sort === "hot" ? "hot" : null, q: q || null, ...o };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
    const s = u.toString();
    return `/community${s ? `?${s}` : ""}`;
  };
  const newHref = `/community/new${complexId ? `?complex=${complexId}` : sgg ? `?sgg=${sgg}` : ""}`;
  const title = complex ? `${complex.name} 이야기` : sggName ? `${shortSgg(sggName)} 이야기` : "동네 이야기";

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        sub={complex ? `${shortSgg(sggName)} ${complex.umd_nm ?? ""} · 단지 글은 ${shortSgg(sggName)} 게시판에도 함께 보입니다` : sggName ? sggName : "관심 부동산의 단지·시군구 글을 모아 봅니다"}
        action={<LinkButton href={canWrite(me) ? newHref : `/community/profile?next=${encodeURIComponent(newHref)}`}><PenSquare size={16} />글쓰기</LinkButton>}
      />

      {!canWrite(me) ? (
        <Notice>
          글·댓글을 쓰려면 <Link href="/community/profile" className="font-semibold text-accent underline">닉네임을 정하고 운영 원칙에 동의</Link>하세요. 이메일은 다른 사용자에게 보이지 않습니다.
        </Notice>
      ) : me.mutedUntil ? (
        <Notice tone="warn">운영 원칙 위반으로 {me.mutedUntil.slice(0, 10)}까지 글·댓글 작성이 제한되었습니다.</Notice>
      ) : null}

      {/* 게시판 고르기: 구독 전체 / 시군구 / 단지 */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        <BoardChip href="/community" active={feed}>내 구독 전체</BoardChip>
        {subs.sggs.map((s) => (
          <BoardChip key={s.sgg} href={`/community?sgg=${s.sgg}`} active={sgg === s.sgg && !complexId}>{shortSgg(s.name)}</BoardChip>
        ))}
        {subs.complexes.map((c) => (
          <BoardChip key={c.id} href={`/community?complex=${c.id}`} active={complexId === c.id}><Building2 size={12} className="mr-0.5 inline" />{c.name}</BoardChip>
        ))}
        {boardSgg && !subs.sggs.some((s) => s.sgg === boardSgg) ? (
          <BoardChip href={`/community?sgg=${boardSgg}`} active={!complexId}>{shortSgg(sggName)}</BoardChip>
        ) : null}
        {complex && !subs.complexes.some((c) => c.id === complex.id) ? <BoardChip href={`/community?complex=${complex.id}`} active>{complex.name}</BoardChip> : null}
      </div>

      {/* 게시판 머리: 구독·이동·요약 */}
      {!feed ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FollowButton
              scope={complexId ? "complex" : "sgg"}
              id={String(complexId ?? sgg)}
              following={following}
              auto={complexId ? subs.complexes.some((c) => c.id === complexId && c.auto) : subs.sggs.some((s) => s.sgg === sgg && s.auto)}
            />
            {complex ? <LinkButton href={`/complexes/${complex.id}`} variant="secondary" className="h-8 px-3 text-xs"><Building2 size={13} />단지 시세</LinkButton> : null}
            {complex ? <LinkButton href={`/community?sgg=${complex.sgg}`} variant="secondary" className="h-8 px-3 text-xs">{shortSgg(sggName)} 게시판</LinkButton> : null}
            <LinkButton href={`/indicators?sgg=${boardSgg}`} variant="secondary" className="h-8 px-3 text-xs"><LineChart size={13} />지표</LinkButton>
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{complexId ? "이 단지 FAQ" : "이번 주 동네 이야기"}</span>
              <SummaryButton scope={complexId ? "complex_faq" : "sgg_week"} id={String(complexId ?? sgg)} label={summary ? "다시 요약" : complexId ? "글 모아 FAQ 만들기" : "AI로 요약하기"} />
            </div>
            {summary ? (
              <>
                <Markdown>{summary.content_md}</Markdown>
                <p className="mt-1 text-[11px] text-muted">글 {summary.post_count}개 기준 · {timeAgo(summary.updated_at)} · AI 요약</p>
              </>
            ) : (
              <p className="text-xs text-muted">{complexId ? "이야기 글이 3개 이상 모이면 자주 나온 주제를 FAQ로 정리할 수 있습니다." : "지난 7일 글의 주요 주제와 의견 흐름을 AI가 요약합니다."}</p>
            )}
          </div>
        </Card>
      ) : null}

      {/* 말머리·정렬·검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          <FilterChip href={qs({ cat: null, page: null })} active={!category}>전체</FilterChip>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <FilterChip key={k} href={qs({ cat: k, page: null })} active={category === k}>{v.label}</FilterChip>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 text-sm">
          <Link href={qs({ sort: null, page: null })} className={sort === "new" ? "font-semibold text-accent" : "text-muted"}>최신</Link>
          <span className="text-border">|</span>
          <Link href={qs({ sort: "hot", page: null })} className={sort === "hot" ? "font-semibold text-accent" : "text-muted"}>인기</Link>
        </div>
      </div>
      <form action="/community" className="flex gap-2">
        {sgg ? <input type="hidden" name="sgg" value={sgg} /> : null}
        {complexId ? <input type="hidden" name="complex" value={complexId} /> : null}
        {category ? <input type="hidden" name="cat" value={category} /> : null}
        <Input name="q" defaultValue={q} placeholder="제목·본문 검색 (예: 주차, 학원가, 재건축)" className="h-10" />
        <button type="submit" className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:text-text" aria-label="검색"><Search size={16} /></button>
      </form>

      <Card className="overflow-hidden">
        <PostList
          posts={posts}
          showBoard={feed || Boolean(sgg)}
          empty={
            q ? `"${q}" 검색 결과가 없습니다.` : feed && !hasSubs ? (
              <>관심 부동산을 등록하면 그 단지·시군구 게시판이 자동으로 구독됩니다.<br /><Link href="/items/new" className="text-accent underline">관심 부동산 등록</Link></>
            ) : (
              <>아직 글이 없습니다. 첫 글을 남겨 이웃과 이야기를 시작해 보세요.<br /><Link href={newHref} className="text-accent underline">글쓰기</Link></>
            )
          }
        />
        {page > 1 || more ? (
          <div className="flex justify-between border-t border-border px-4 py-2 text-sm">
            {page > 1 ? <Link href={qs({ page: page - 1 > 1 ? page - 1 : null })} className="text-accent">← 이전</Link> : <span />}
            {more ? <Link href={qs({ page: page + 1 })} className="text-accent">다음 →</Link> : <span />}
          </div>
        ) : null}
      </Card>

      {rollup.length ? (
        <Card className="overflow-hidden">
          <CardHeader title={`${shortSgg(sggName)} 인기글`} sub="같은 시군구 게시판에서" action={<Link href={`/community?sgg=${complex!.sgg}`} className="text-accent">더 보기</Link>} />
          <PostList posts={rollup} />
        </Card>
      ) : null}

      {popular.length ? (
        <Card>
          <CardHeader title="활발한 게시판" sub="최근 30일 글이 많은 시군구" />
          <div className="flex flex-wrap gap-1.5 px-4 pb-4">
            {popular.map((p) => (
              <BoardChip key={p.sgg} href={`/community?sgg=${p.sgg}`} active={false}>{popularNames[p.sgg] ?? p.sgg} · {p.n}</BoardChip>
            ))}
          </div>
        </Card>
      ) : null}

      <p className="text-center text-xs text-muted">
        <Link href="/community/rules" className="underline">운영 원칙</Link> · <Link href="/community/profile" className="underline">내 활동·설정</Link>
      </p>
    </div>
  );
}

function BoardChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] ${active ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted hover:text-text"}`}>
      {children}
    </Link>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} scroll={false} className={`rounded-md px-2 py-1 text-[13px] ${active ? "bg-text text-surface" : "text-muted hover:bg-surface-2"}`}>
      {children}
    </Link>
  );
}
