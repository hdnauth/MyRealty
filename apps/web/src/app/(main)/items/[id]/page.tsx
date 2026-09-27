import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TypeIcon } from "@/components/items/item-card";
import { Badge, LinkButton, Tabs } from "@/components/ui";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { getAreaUnit } from "@/lib/area-unit";
import { formatArea } from "@/lib/format";
import { GROUP_TAGS, PROPERTY_TYPES } from "@/lib/property";
import { getItem, itemDataStatus } from "@/lib/queries/items";
import { DataStatusCard } from "@/components/items/data-status";
import { NearbyTab } from "./tabs/nearby";
import { AnalysisTab } from "./tabs/analysis";
import { LocationTab } from "./tabs/location";
import { NewsTab } from "./tabs/news";
import { NotesTab } from "./tabs/notes";
import { OverviewTab } from "./tabs/overview";
import { PriceTab } from "./tabs/price";

export async function generateMetadata(props: PageProps<"/items/[id]">): Promise<Metadata> {
  const [uid, { id }] = await Promise.all([sessionUserId(), props.params]);
  const [, item] = await Promise.all([requireUser(), getItem(uid, id)]);
  return { title: item?.label ?? "부동산" };
}

const TABS = [
  { key: "overview", label: "개요" },
  { key: "price", label: "시세" },
  { key: "nearby", label: "주변" },
  { key: "location", label: "입지" },
  { key: "news", label: "소식" },
  { key: "analysis", label: "분석" },
  { key: "notes", label: "메모" },
] as const;

export default async function ItemPage(props: PageProps<"/items/[id]">) {
  const [uid, { id }, sp] = await Promise.all([sessionUserId(), props.params, props.searchParams]);
  const [, item, unit] = await Promise.all([requireUser(), getItem(uid, id), getAreaUnit()]);
  if (!item) notFound();
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "overview";
  const welcome = sp.welcome === "1";
  const status = tab === "overview" ? await itemDataStatus(item) : null;

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
            {item.road_address ?? item.jibun_address} · {formatArea(item.area_m2 ?? item.land_area_m2, unit)}
            {item.floor ? ` · ${item.floor}층` : ""}
          </p>
        </div>
        <LinkButton href={`/items/${item.id}/edit`} variant="secondary" className="shrink-0" aria-label="수정">
          <Pencil size={16} />
          <span className="hidden sm:inline">수정</span>
        </LinkButton>
      </div>

      {status ? <DataStatusCard item={item} st={status} welcome={welcome} /> : null}

      <Tabs active={tab} items={TABS.map((t) => ({ ...t, href: `/items/${item.id}?tab=${t.key}` }))} />

      {tab === "overview" ? <OverviewTab item={item} /> : null}
      {tab === "price" ? <PriceTab item={item} all={sp.all === "1"} /> : null}
      {tab === "nearby" ? <NearbyTab item={item} /> : null}
      {tab === "location" ? <LocationTab item={item} /> : null}
      {tab === "news" ? <NewsTab item={item} /> : null}
      {tab === "analysis" ? <AnalysisTab item={item} /> : null}
      {tab === "notes" ? <NotesTab item={item} /> : null}
    </div>
  );
}
