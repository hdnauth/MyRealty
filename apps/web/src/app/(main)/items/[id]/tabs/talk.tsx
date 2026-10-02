import Link from "next/link";
import { BoardTeaser } from "@/components/community/board-teaser";
import { Card, EmptyState } from "@/components/ui";
import type { WatchItem } from "@/lib/queries/items";

/** 이 부동산의 단지(없으면 시군구) 이야기 */
export async function TalkTab({ item }: { item: WatchItem }) {
  if (!item.sgg_cd) {
    return (
      <Card>
        <EmptyState title="지역 정보가 없습니다" desc="주소를 다시 저장하면 시군구 게시판이 연결됩니다." action={<Link href={`/items/${item.id}/edit`} className="text-accent">수정하기</Link>} />
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <BoardTeaser uid={item.user_id} sgg={item.sgg_cd} complexId={item.complex_id} complexName={item.complex_name} limit={8} />
      {item.complex_id ? <BoardTeaser uid={item.user_id} sgg={item.sgg_cd} limit={5} /> : null}
    </div>
  );
}
