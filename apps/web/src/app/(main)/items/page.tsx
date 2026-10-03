import { Map as MapIcon, Plus, Search } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { ItemCard } from "@/components/items/item-card";
import { GuestNote } from "@/components/shell/member-gate";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { pageUser, sessionUserId } from "@/lib/auth/session";
import { GROUP_TAGS } from "@/lib/property";
import { listItems } from "@/lib/queries/items";
import { getAreaUnit } from "@/lib/area-unit";

export const metadata: Metadata = { title: "관심 부동산" };

export default async function ItemsPage() {
  const uid = await sessionUserId();
  const [user, items, unit] = await Promise.all([pageUser(uid), listItems(uid), getAreaUnit()]);
  const groups = Object.entries(GROUP_TAGS)
    .map(([k, label]) => ({ k, label, items: items.filter((i) => i.group_tag === k) }))
    .filter((g) => g.items.length);
  return (
    <div>
      <PageHeader
        title="관심 부동산"
        sub={`${items.length}개 등록`}
        action={
          <LinkButton href="/items/new">
            <Plus size={16} /> 등록
          </LinkButton>
        }
      />
      {items.length === 0 ? (
        <Card className="px-5 py-8">
          <div className="mx-auto max-w-md text-center">
            <p className="text-lg font-semibold">관심 있는 부동산을 등록해 보세요</p>
            <p className="mt-1 text-sm text-muted">
              실거래·추정 시세·주변 개발·뉴스를 모아 매일 알려 드립니다. 로그인 없이 바로 쓸 수 있어요.
            </p>
          </div>
          <div className="mx-auto mt-6 grid max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
            <Link href="/map" className="flex items-center gap-3 rounded-xl border border-border p-4 hover:border-accent/50 hover:bg-surface-2">
              <MapIcon size={22} className="shrink-0 text-accent" />
              <span>
                <span className="block font-medium">지도에서 찾기</span>
                <span className="text-xs text-muted">단지를 눌러 ★ 관심 등록</span>
              </span>
            </Link>
            <Link href="/items/new" className="flex items-center gap-3 rounded-xl border border-border p-4 hover:border-accent/50 hover:bg-surface-2">
              <Search size={22} className="shrink-0 text-accent" />
              <span>
                <span className="block font-medium">주소로 등록</span>
                <span className="text-xs text-muted">아파트·빌라·토지·상가</span>
              </span>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {user?.isGuest ? <GuestNote /> : null}
          {groups.map((g) => (
            <section key={g.k}>
              <h2 className="mb-2 text-sm font-semibold text-muted">
                {g.label} · {g.items.length}
              </h2>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {g.items.map((i) => (
                  <ItemCard key={i.id} item={i} unit={unit} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
