import { ChevronRight, PenSquare } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import { listPosts, shortSgg, sggNames, subscriptions } from "@/lib/community/queries";
import { PostList } from "./parts";

/**
 * 단지(또는 시군구) 이야기 미리보기. 단지 글이 적으면 같은 시군구 인기글을 함께 보여 준다(빈 게시판 완화).
 */
export async function BoardTeaser({ uid, sgg, complexId, complexName, limit = 5 }: { uid: string; sgg: string; complexId?: number | null; complexName?: string | null; limit?: number }) {
  const [own, names] = await Promise.all([
    listPosts({ uid, complexId: complexId ?? null, sgg: complexId ? null : sgg, limit }),
    sggNames([sgg]),
  ]);
  const region = shortSgg(names[sgg]);
  const fill = complexId && own.length < 3 ? await listPosts({ uid, sgg, excludeComplex: complexId, sort: "hot", limit: limit - own.length }) : [];
  const board = complexId ? `/community?complex=${complexId}` : `/community?sgg=${sgg}`;
  const write = complexId ? `/community/new?complex=${complexId}` : `/community/new?sgg=${sgg}`;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={complexId ? `${complexName ?? "이 단지"} 이야기` : `${region} 이야기`}
        sub={complexId ? `단지 글은 ${region} 게시판에도 함께 보입니다` : "이웃과 정보·의견을 나눠 보세요"}
        action={
          <span className="flex items-center gap-3">
            <Link href={write} className="flex items-center gap-0.5 text-accent"><PenSquare size={14} />글쓰기</Link>
            <Link href={board} className="flex items-center text-muted hover:text-accent">전체<ChevronRight size={16} /></Link>
          </span>
        }
      />
      <PostList posts={own} showBoard={false} empty={complexId ? "아직 이 단지 글이 없습니다. 궁금한 점을 먼저 물어보세요." : "아직 글이 없습니다."} />
      {fill.length ? (
        <>
          <p className="border-t border-border px-4 pt-3 text-xs font-medium text-muted">{region} 인기글</p>
          <PostList posts={fill} />
        </>
      ) : null}
    </Card>
  );
}

/** 홈: 구독 게시판(관심 부동산의 단지·시군구) 새 글 */
export async function NeighborhoodFeed({ uid, limit = 5 }: { uid: string; limit?: number }) {
  const subs = await subscriptions(uid);
  if (!subs.sggs.length && !subs.complexes.length) return null;
  const posts = await listPosts({ uid, feed: { sggs: subs.sggs.map((s) => s.sgg), complexIds: subs.complexes.map((c) => c.id) }, limit });
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="내 동네 소식"
        sub={subs.sggs.map((s) => shortSgg(s.name)).join(" · ")}
        action={<Link href="/community" className="flex items-center text-accent">전체<ChevronRight size={16} /></Link>}
      />
      <PostList
        posts={posts}
        empty={<>아직 글이 없습니다. <Link href="/community/new" className="text-accent underline">첫 글을 남겨</Link> 이웃과 이야기를 시작해 보세요.</>}
      />
    </Card>
  );
}
