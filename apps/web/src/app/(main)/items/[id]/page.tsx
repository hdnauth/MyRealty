import { Map as MapIcon, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TypeIcon } from "@/components/items/item-card";
import { Badge, LinkButton, Tabs } from "@/components/ui";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { getAreaUnit } from "@/lib/area-unit";
import { formatArea, shortAddress } from "@/lib/format";
import { GROUP_TAGS, PROPERTY_TYPES } from "@/lib/property";
import { complexSales, getItem, itemDataStatus } from "@/lib/queries/items";
import { fillMissingItemGeoms } from "@/lib/external/geocode";
import { collectRunner, latestRun } from "@/lib/collect";
import { DataStatusCard } from "@/components/items/data-status";
import { ItemSwitcher, type SwitcherItem } from "@/components/items/item-switcher";
import { AreaBar } from "@/components/items/area-bar";
import { clusterAreas } from "@/lib/units";
import { sql } from "@/lib/db";
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
  const [user, first, unit, siblings] = await Promise.all([
    requireUser(),
    getItem(uid, id),
    getAreaUnit(),
    // 다른 관심 부동산으로 바로 옮겨 가기(그룹 순 → 목록 순)
    sql<SwitcherItem[]>`
      select id, label, property_type, group_tag from watch_items where user_id = ${uid}
      order by array_position(array['owned', 'candidate', 'watch', 'tenant'], group_tag), sort_order, created_at`,
  ]);
  if (!first) notFound();
  let item = first;
  // 좌표가 없으면(등록 때 지오코딩 실패 등) 지금 채운다 — 주변·입지·지도가 비지 않도록
  if (item.lng === null && (await fillMissingItemGeoms(user.id).catch(() => 0)) > 0) item = (await getItem(uid, id)) ?? item;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "overview";
  const welcome = sp.welcome === "1";
  const areaTab = tab === "overview" || tab === "price" || tab === "nearby";
  const [[status, run], sales] = await Promise.all([
    tab === "overview" ? Promise.all([itemDataStatus(item), latestRun(item.id)]) : Promise.resolve([null, null] as const),
    // 평형 막대: 이 단지에서 최근 3년 거래된 평형(많은 순 6개, 면적 순)
    item.complex_id && areaTab ? complexSales(item.complex_id, 3) : Promise.resolve([]),
  ]);
  const areaTypes = clusterAreas(
    [...sales.reduce((m, x) => m.set(x.area_m2, (m.get(x.area_m2) ?? 0) + 1), new Map<number, number>())].map(([area, count]) => ({ area, count, trades: count })),
  )
    .sort((a, b) => b.trades - a.trades)
    .slice(0, 6)
    .sort((a, b) => a.area - b.area)
    .map((t) => ({ area: Math.round(t.area * 100) / 100, label: formatArea(t.area, unit).split(" ")[0], trades: t.trades }));
  // ?area= : 저장하지 않고 다른 평형 기준으로 보기(단지형만). 탭에는 면적만 바꾼 부동산을 넘긴다
  const wanted = Number(sp.area);
  const viewing = item.complex_id && Number.isFinite(wanted) && wanted > 5 && wanted < 1000 ? wanted : null;
  const viewItem = viewing !== null ? { ...item, area_m2: viewing } : item;

  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <TypeIcon type={item.property_type} size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl" title={item.label}>
              {shortAddress(item.label)}
            </h1>
            <Badge tone="accent">{PROPERTY_TYPES[item.property_type].label}</Badge>
            <Badge>{GROUP_TAGS[item.group_tag as keyof typeof GROUP_TAGS]}</Badge>
            <ItemSwitcher items={siblings} currentId={item.id} tab={tab} />
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            {item.road_address ?? item.jibun_address} · {formatArea(item.area_m2 ?? item.land_area_m2, unit)}
            {item.floor ? ` · ${item.floor}층` : ""}
          </p>
        </div>
        {item.lng !== null ? (
          <LinkButton href={`/map?item=${item.id}`} variant="secondary" className="shrink-0" aria-label="지도">
            <MapIcon size={16} />
            <span className="hidden sm:inline">지도</span>
          </LinkButton>
        ) : null}
        <LinkButton href={`/items/${item.id}/edit`} variant="secondary" className="shrink-0" aria-label="수정">
          <Pencil size={16} />
          <span className="hidden sm:inline">수정</span>
        </LinkButton>
      </div>

      {status ? <DataStatusCard item={item} st={status} welcome={welcome} run={run} runnerReady={collectRunner() !== null} /> : null}

      <Tabs active={tab} items={TABS.map((t) => ({ ...t, href: `/items/${item.id}?tab=${t.key}${viewing !== null && (t.key === "overview" || t.key === "price" || t.key === "nearby") ? `&area=${viewing}` : ""}` }))} />

      {areaTab && (areaTypes.length > 1 || (areaTypes.length === 1 && !item.area_m2)) ? (
        <AreaBar itemId={item.id} tab={tab} types={areaTypes} saved={item.area_m2 ? Number(item.area_m2) : null} viewing={viewing} dongHo={item.dong_ho} />
      ) : null}

      {tab === "overview" ? <OverviewTab item={viewItem} viewing={viewing !== null} /> : null}
      {tab === "price" ? <PriceTab item={viewItem} all={sp.all === "1"} /> : null}
      {tab === "nearby" ? <NearbyTab item={viewItem} all={sp.all === "1"} /> : null}
      {tab === "location" ? <LocationTab item={item} /> : null}
      {tab === "news" ? <NewsTab item={item} /> : null}
      {tab === "analysis" ? <AnalysisTab item={item} /> : null}
      {tab === "notes" ? <NotesTab item={item} /> : null}
    </div>
  );
}
