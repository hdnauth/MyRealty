import { ExternalLink, Map as MapIcon, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { BoardTeaser } from "@/components/community/board-teaser";
import { TypeIcon } from "@/components/items/item-card";
import { MiniMap } from "@/components/map/mini-map";
import { RegionInsights, RegionTrades } from "@/components/map/region-trades";
import { Badge, Card, CardHeader, Change, LinkButton, Stat } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { sessionUserId } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatArea, formatManwon, M2_PER_PYEONG, perUnitArea, unitPriceLabel } from "@/lib/format";
import { monthlyRollingMedian } from "@/lib/item-analytics";
import { mapAtHref, naverLandHref, regionHref } from "@/lib/links";
import { myComplexItems } from "@/lib/queries/items";
import { isRegionType, REGION_TYPE_INFO, REGION_TYPES, type RegionType, regionInsights, regionMarket } from "@/lib/queries/region-market";

/** 거래 내역·추이에 쓰는 최근 거래 수(단독은 월세가 많아 한 동네 5년이 수천 건) */
const TRADE_LIMIT = 1500;
const typeOf = (v: unknown): RegionType | null => (v === "forest" ? "land" : isRegionType(v) ? v : null);

export async function generateMetadata(props: PageProps<"/regions/[lawd]">): Promise<Metadata> {
  const [{ lawd }, sp] = await Promise.all([props.params, props.searchParams]);
  const type = typeOf(sp.type) ?? "land";
  const m = await regionMarket(lawd, type, { limit: 1 });
  return { title: m ? `${m.region.emd} ${REGION_TYPE_INFO[type].label} 시세` : "동네 시세" };
}

/**
 * 동네 시세 상세: 단지가 없는 유형(단독·다가구, 토지, 상가·업무)을 읍면동 단위로 본다.
 * 지도에서 읍면동 라벨을 골라 들어온다. 세부 유형(지목·주택 유형·건물 용도)별 단위가격·추이·거래 내역.
 */
export default async function RegionPage(props: PageProps<"/regions/[lawd]">) {
  const [uid, { lawd }, sp] = await Promise.all([sessionUserId(), props.params, props.searchParams]);
  const wanted = typeOf(sp.type);
  const [unit, mine] = await Promise.all([getAreaUnit(), myComplexItems(uid)]);
  let m = await regionMarket(lawd, wanted ?? "land", { years: 5, limit: TRADE_LIMIT });
  if (!m) notFound();
  // 유형을 안 주고 들어왔는데 토지 거래가 없으면 거래가 가장 많은 유형으로
  if (!wanted && !m.trades.length) {
    const best = [...REGION_TYPES].sort((a, b) => m!.typeCounts[b] - m!.typeCounts[a])[0];
    if (best !== "land" && m.typeCounts[best]) m = (await regionMarket(lawd, best, { years: 5, limit: TRADE_LIMIT }))!;
  }
  const { region, type, stats, groups, zones } = m;
  const info = REGION_TYPE_INFO[type];
  const ptype = type;

  // 세부 유형별 단위가격 추이(매매 · 6개월 이동 중위, 거래 많은 4개)
  const sales = m.trades.filter((t) => t.deal_kind === "sale" && !t.is_canceled && t.area_m2);
  const lines = groups
    .slice(0, 4)
    .map((g) => ({
      name: g.category,
      points: monthlyRollingMedian(
        sales.filter((t) => (t.category ?? "미상") === g.category).map((t) => ({ date: t.deal_date, value: perUnitArea(t.price, t.area_m2, unit)! })),
        { window: 6, minN: 2 },
      ),
    }))
    .filter((l) => l.points.length >= 2);
  const perUnit = (perM2: number | null) => (perM2 === null ? null : unit === "pyeong" ? perM2 * M2_PER_PYEONG : perM2);
  const title = `${region.emd} ${info.label}`;
  const insights = regionInsights(m, unit);

  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-muted">
          <TypeIcon type={ptype} size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl">{title} 시세</h1>
            <Badge>읍면동 단위</Badge>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{[region.sgg_name, region.emd].filter(Boolean).join(" ")} · 최근 5년 실거래</p>
        </div>
        {region.lng !== null && region.lat !== null ? (
          <LinkButton href={mapAtHref(region.lng, region.lat, type)} variant="secondary" className="shrink-0" aria-label="지도">
            <MapIcon size={16} />
            <span className="hidden sm:inline">지도</span>
          </LinkButton>
        ) : null}
        <LinkButton href="/items/new" className="shrink-0 px-3">
          <Star size={16} />
          <span className="hidden sm:inline">주소로 관심 등록</span>
          <span className="sm:hidden">등록</span>
        </LinkButton>
      </div>

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="유형">
        {REGION_TYPES.map((k) => (
          <Link
            key={k}
            href={regionHref(lawd, k)}
            scroll={false}
            aria-current={k === type ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-sm ${k === type ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border bg-surface text-muted hover:border-accent"}`}
          >
            {REGION_TYPE_INFO[k].label} · 1년 {m.typeCounts[k].toLocaleString()}건
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 text-xs text-muted">최근 1년 · 해제 거래 제외</div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="매매 거래" value={`${stats.sale12m.toLocaleString()}건`} />
            <Stat label="매매 중위" value={formatManwon(stats.salePrice12m)} />
            <Stat
              label={`${info.area} ${unitPriceLabel(unit)}`}
              value={formatManwon(perUnit(stats.perM2_12m), { short: true })}
              sub={<span className="text-muted">1년 <Change value={stats.change1y} /></span>}
            />
            {type === "house" ? (
              <>
                <Stat label="전세 거래" value={`${stats.jeonse12m.toLocaleString()}건`} />
                <Stat label="월세 거래" value={`${stats.wolse12m.toLocaleString()}건`} />
              </>
            ) : null}
          </div>
        </Card>
        <Card className="flex flex-col justify-between gap-3 p-4">
          <p className="text-sm leading-relaxed text-muted">
            {info.label} 실거래는 지번 일부가 가려져(예: 1**) 신고되고 건물명이 없어, 같은 필지·건물끼리 묶을 수 없습니다. 이 화면은 같은 읍면동 거래를{" "}
            {info.category}별로 나눠 비교합니다. 위치는 읍면동 중심입니다.
          </p>
          <a href={naverLandHref(region.emd, "")} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-medium text-accent">
            이 동네 매물 보기(네이버 부동산) <ExternalLink size={13} />
          </a>
        </Card>

        {insights.length ? (
          <Card className="lg:col-span-3">
            <CardHeader title="눈여겨볼 점" sub={`${info.label} 실거래에서 계산 · 표본이 충분할 때만 표시`} />
            <div className="px-4 pb-4">
              <RegionInsights items={insights} />
            </div>
          </Card>
        ) : null}

        <Card className="lg:col-span-3">
          <CardHeader title={`${info.category}별 시세`} sub={`매매 · 최근 5년 · ${info.area} ${unitPriceLabel(unit)} 중위`} />
          {groups.length ? (
            <div className="overflow-x-auto pb-2">
              <table className="w-full min-w-[480px] whitespace-nowrap text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">{info.category}</th>
                    <th className="px-2 py-2 text-right font-medium">5년 · 1년</th>
                    <th className="px-2 py-2 text-right font-medium">{unitPriceLabel(unit)}</th>
                    <th className="px-2 py-2 text-right font-medium">거래가 중위</th>
                    <th className="px-4 py-2 text-right font-medium">{info.area} 중위</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {groups.map((g) => (
                    <tr key={g.category} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 font-medium">{g.category}</td>
                      <td className="px-2 py-2 text-right">
                        {g.n.toLocaleString()} · {g.n12m.toLocaleString()}건
                      </td>
                      <td className="px-2 py-2 text-right font-semibold">{formatManwon(perUnit(g.perM2), { short: true })}</td>
                      <td className="px-2 py-2 text-right">{formatManwon(g.price, { short: true })}</td>
                      <td className="px-4 py-2 text-right">{formatArea(g.area, unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted">최근 5년 매매가 없습니다.</p>
          )}
        </Card>

        {lines.length ? (
          <Card className="lg:col-span-3">
            <CardHeader title={`${info.category}별 ${unitPriceLabel(unit)} 추이`} sub="매매 · 6개월 이동 중위(창 안 2건 이상인 달만)" />
            <div className="px-2 pb-3">
              <LineSeriesChart lines={lines} fmt="manwon" height={240} endLabels />
            </div>
          </Card>
        ) : null}

        {zones.length ? (
          <Card className={region.lng !== null ? "" : "lg:col-span-3"}>
            <CardHeader title="용도지역별 시세" sub={`매매 · 최근 5년 · ${unitPriceLabel(unit)} 중위`} />
            <ul className="divide-y divide-border px-4 pb-2 text-sm">
              {zones.map((z) => (
                <li key={z.zone} className="flex items-center justify-between gap-2 py-2 tabular">
                  <span className="min-w-0 truncate">{z.zone}</span>
                  <span className="shrink-0 text-muted">{z.n}건</span>
                  <b className="w-20 shrink-0 text-right">{formatManwon(perUnit(z.perM2), { short: true })}</b>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {region.lng !== null && region.lat !== null ? (
          <Card className={zones.length ? "lg:col-span-2" : "lg:col-span-3"}>
            <CardHeader
              title="위치"
              sub={`주변 읍면동 최근 1년 ${info.label} 매매 — 라벨을 누르면 그 동네로`}
              action={
                <Link href={mapAtHref(region.lng, region.lat, type)} className="text-sm text-accent">
                  큰 지도
                </Link>
              }
            />
            <div className="px-4 pb-4">
              <MiniMap keys={{ keyId: env.ncpKeyId ?? null, vworldKey: env.vworldKey ?? null }} center={[region.lng, region.lat]} radius={1000} label={region.emd} txType={type} unit={unit} myComplexes={mine} />
            </div>
          </Card>
        ) : null}

        <Card className="p-4 lg:col-span-3">
          <h2 className="text-base font-semibold">거래 내역</h2>
          <RegionTrades data={m} unit={unit} kind="sale" limit={30} years={5} capped={m.trades.length >= TRADE_LIMIT} />
        </Card>

        <div className="lg:col-span-3">
          <BoardTeaser uid={uid} sgg={region.sgg_cd} />
        </div>
      </div>
    </div>
  );
}
