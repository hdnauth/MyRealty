import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { ItemCard } from "@/components/items/item-card";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { GROUP_TAGS } from "@/lib/property";
import { listItems } from "@/lib/queries/items";

export const metadata: Metadata = { title: "내 물건" };

export default async function ItemsPage() {
  const user = await requireUser();
  const items = await listItems(user.id);
  const groups = Object.entries(GROUP_TAGS)
    .map(([k, label]) => ({ k, label, items: items.filter((i) => i.group_tag === k) }))
    .filter((g) => g.items.length);
  return (
    <div>
      <PageHeader
        title="내 물건"
        sub={`${items.length}개 등록`}
        action={
          <LinkButton href="/items/new">
            <Plus size={16} /> 등록
          </LinkButton>
        }
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState
            title="아직 등록한 물건이 없습니다"
            desc="보유 중이거나 관심 있는 아파트·빌라·토지 등을 등록하면 실거래·주변 시세·뉴스를 자동으로 모아 드립니다."
            action={<LinkButton href="/items/new">첫 물건 등록하기</LinkButton>}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.k}>
              <h2 className="mb-2 text-sm font-semibold text-muted">
                {g.label} · {g.items.length}
              </h2>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {g.items.map((i) => (
                  <ItemCard key={i.id} item={i} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
