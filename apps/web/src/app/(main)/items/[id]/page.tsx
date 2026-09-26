import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TypeIcon } from "@/components/items/item-card";
import { Badge, Card, LinkButton, Tabs } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatArea } from "@/lib/format";
import { GROUP_TAGS, PROPERTY_TYPES } from "@/lib/property";
import { getItem } from "@/lib/queries/items";
import { NearbyTab } from "./tabs/nearby";
import { LocationTab } from "./tabs/location";
import { NewsTab } from "./tabs/news";
import { OverviewTab } from "./tabs/overview";
import { PriceTab } from "./tabs/price";

export async function generateMetadata(props: PageProps<"/items/[id]">): Promise<Metadata> {
  const user = await requireUser();
  const item = await getItem(user.id, (await props.params).id);
  return { title: item?.label ?? "물건" };
}

const TABS = [
  { key: "overview", label: "개요" },
  { key: "price", label: "시세" },
  { key: "nearby", label: "주변" },
  { key: "location", label: "입지" },
  { key: "news", label: "소식" },
] as const;

export default async function ItemPage(props: PageProps<"/items/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const item = await getItem(user.id, id);
  if (!item) notFound();
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "overview";

  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <TypeIcon type={item.property_type} size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl">{item.label}</h1>
            <Badge tone="accent">{PROPERTY_TYPES[item.property_type].label}</Badge>
            <Badge>{GROUP_TAGS[item.group_tag as keyof typeof GROUP_TAGS]}</Badge>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            {item.road_address ?? item.jibun_address} · {formatArea(item.area_m2 ?? item.land_area_m2)}
            {item.floor ? ` · ${item.floor}층` : ""}
          </p>
        </div>
        <LinkButton href={`/items/${item.id}/edit`} variant="secondary" className="shrink-0" aria-label="수정">
          <Pencil size={16} />
          <span className="hidden sm:inline">수정</span>
        </LinkButton>
      </div>

      <Tabs active={tab} items={TABS.map((t) => ({ ...t, href: `/items/${item.id}?tab=${t.key}` }))} />

      {tab === "overview" ? <OverviewTab item={item} /> : null}
      {tab === "price" ? <PriceTab item={item} all={sp.all === "1"} /> : null}
      {tab === "nearby" ? <NearbyTab item={item} /> : null}
      {tab === "location" ? <LocationTab item={item} /> : null}
      {tab === "news" ? <NewsTab item={item} /> : null}
      {!item.complex_id && PROPERTY_TYPES[item.property_type].hasComplex ? (
        <Card className="mt-4 p-4 text-sm text-muted">
          단지가 아직 연결되지 않았습니다. 실거래 수집(ETL) 후 자동으로 연결됩니다.
        </Card>
      ) : null}
    </div>
  );
}
