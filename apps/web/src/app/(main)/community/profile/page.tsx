import type { Metadata } from "next";
import Link from "next/link";
import { BlockButton } from "@/components/community/interactive";
import { PostList } from "@/components/community/parts";
import { ProfileForm, ResidenceCheck } from "@/components/community/profile-form";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { communityMe, listBlocks, listPosts } from "@/lib/community/queries";
import { levelOf, RESIDENCE } from "@/lib/community/rules";

export const metadata: Metadata = { title: "내 활동·설정" };

export default async function CommunityProfilePage(props: PageProps<"/community/profile">) {
  const [user, sp] = await Promise.all([requireUser(), props.searchParams]);
  const next = typeof sp.next === "string" && sp.next.startsWith("/community") ? sp.next : null;
  const [me, mine, counts, residences, settings, blocks] = await Promise.all([
    communityMe(user.id, user.isAdmin),
    listPosts({ uid: user.id, userId: user.id, limit: 20 }),
    sql<{ posts: number; comments: number; likes: number }[]>`
      select (select count(*)::int from community_posts where user_id = ${user.id} and status <> 'deleted') as posts,
             (select count(*)::int from community_comments where user_id = ${user.id} and status <> 'deleted') as comments,
             (select coalesce(sum(like_count), 0)::int from community_posts where user_id = ${user.id} and status = 'visible') +
             (select coalesce(sum(like_count), 0)::int from community_comments where user_id = ${user.id} and status = 'visible') as likes`,
    sql<{ id: number; name: string; days: number; verified: boolean }[]>`
      select distinct on (c.id) c.id, c.name, coalesce(jsonb_array_length(r.checks), 0) as days,
             coalesce(r.verified_at is not null and r.expires_at > now(), false) as verified
      from watch_items w join complexes c on c.id = w.complex_id
      left join community_residences r on r.user_id = w.user_id and r.complex_id = c.id
      where w.user_id = ${user.id} and c.geom is not null order by c.id`,
    sql<{ settings: { communityPush?: boolean } }[]>`select settings from users where id = ${user.id}`,
    listBlocks(user.id),
  ]);
  const level = levelOf(me.points);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={me.nickname ? "내 활동·설정" : "동네 이야기 시작하기"} sub={me.nickname ? `${me.nickname} · ${level.label}` : "닉네임을 정하면 글과 댓글을 쓸 수 있습니다. 이메일은 공개되지 않습니다."} />
      <Card className="p-4">
        <ProfileForm nickname={me.nickname} agreed={Boolean(me.agreedAt)} showOwner={me.showOwner} push={settings[0]?.settings?.communityPush !== false} next={next} />
      </Card>
      {me.nickname ? (
        <>
          <Card className="grid grid-cols-4 gap-3 p-4">
            <Stat label="활동 점수" value={me.points} sub={<span className="text-muted">{level.label}</span>} />
            <Stat label="글" value={counts[0].posts} />
            <Stat label="댓글" value={counts[0].comments} />
            <Stat label="받은 좋아요" value={counts[0].likes} />
          </Card>
          <p className="-mt-2 px-1 text-xs text-muted">등급: 새내기 → 이웃(20점) → 단골(100점) → 터줏대감(300점). 글 3점, 댓글 1점, 받은 좋아요 1점, 운영 원칙 위반으로 가려지면 -10점.</p>
          <Card>
            <CardHeader title="거주 인증" sub={`단지 반경 ${RESIDENCE.radiusM}m 안에서 서로 다른 날 ${RESIDENCE.days}번 위치를 확인하면 '거주 인증' 배지가 붙습니다(1년 유지). 좌표는 저장하지 않고 단지까지 거리만 확인합니다.`} />
            {residences.length ? (
              <ul className="divide-y divide-border px-4 pb-2">
                {residences.map((r) => <ResidenceCheck key={r.id} complexId={r.id} name={r.name} days={r.days} need={RESIDENCE.days} verified={r.verified} />)}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-sm text-muted">관심 부동산으로 등록한 단지가 있어야 인증할 수 있습니다.</p>
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="내가 쓴 글" />
            <PostList posts={mine} empty={<Link href="/community" className="text-accent underline">동네 이야기 보러 가기</Link>} />
          </Card>
        </>
      ) : null}
      {blocks.length ? (
        <Card>
          <CardHeader title="차단한 사용자" sub="차단한 사용자의 글은 목록에서 빠지고 댓글은 가려집니다. 상대에게는 알리지 않습니다." />
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                <span>{b.nickname ?? "이름 없음"} <span className="text-xs text-muted">· {b.created_at.slice(0, 10)}</span></span>
                <BlockButton userId={b.id} nickname={b.nickname ?? "이름 없음"} blocked />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
