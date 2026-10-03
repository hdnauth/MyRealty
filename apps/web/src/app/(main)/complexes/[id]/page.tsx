import { Map as MapIcon, Plus, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceHistoryChart } from "@/components/charts/price-history";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { BoardTeaser } from "@/components/community/board-teaser";
import { TypeIcon } from "@/components/items/item-card";
import { TxTable } from "@/components/items/tx-table";
import { MiniMap } from "@/components/map/mini-map";
import { Badge, Card, CardHeader, Change, LinkButton, Stat } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatArea, formatDate, formatManwon, formatNumber, formatPct, perUnitArea, unitPriceLabel, unitPriceName } from "@/lib/format";
import { monthlyRollingMedian } from "@/lib/item-analytics";
import { mapComplexHref, registerComplexHref } from "@/lib/links";
import { isPropertyType, PROPERTY_TYPES } from "@/lib/property";
import { complexLocation, complexTransactions, getComplex } from "@/lib/queries/complexes";
import { complexZones } from "@/lib/queries/projects";
import { ZONE_STAGES } from "@/lib/projects";
import { myComplexItems, summarize } from "@/lib/queries/items";
import { clusterAreas } from "@/lib/units";
import { detailText, ORDER } from "../../items/[id]/tabs/location";

export async function generateMetadata(props: PageProps<"/complexes/[id]">): Promise<Metadata> {
  const c = await getComplex(Number((await props.params).id));
  return { title: c?.name ?? "단지" };
}

/**
 * 단지 상세: 관심 부동산이 아니어도 수집된 단지면 볼 수 있다(유사 단지·주변 거래·지도에서 눌러 들어온다).
 * 평형을 골라(?area=) 그 평형 기준 시세·추이·거래를 보고, 관심 부동산으로 바로 등록할 수 있다.
 */
export default async function ComplexPage(props: PageProps<"/complexes/[id]">) {
  const [uid, { id: raw }, sp] = await Promise.all([sessionUserId(), props.params, props.searchParams]);
  const id = Number(raw);
  const [, c, unit, mine] = await Promise.all([requireUser(), getComplex(id), getAreaUnit(), myComplexItems(uid)]);
  if (!c) notFound();
  const [txs, loc, zones] = await Promise.all([complexTransactions(id, 5), complexLocation(id), complexZones(id)]);
  const myItemId = mine[id] ?? null;

  // 평형(전용면적) 목록: 거래 많은 순 최대 6개. 기본은 가장 많이 거래된 평형
  const sales = txs.filter((t) => t.deal_kind === "sale" && !t.is_canceled && t.area_m2);
  const types = clusterAreas(
    [...txs.filter((t) => t.area_m2).reduce((m, t) => m.set(Number(t.area_m2), (m.get(Number(t.area_m2)) ?? 0) + 1), new Map<number, number>())].map(
      ([area, count]) => ({ area, count, trades: count }),
    ),
  )
    .sort((a, b) => b.trades - a.trades)
    .slice(0, 6)
    .sort((a, b) => a.area - b.area);
  const wanted = Number(sp.area);
  const pick =
    // ?area= 와 가장 가까운 평형(±15% 안) — 다른 단지에서 비교하며 들어올 때 면적이 정확히 같지 않다
    (Number.isFinite(wanted) && wanted > 0
      ? [...types].sort((a, b) => Math.abs(a.area - wanted) - Math.abs(b.area - wanted)).find((t) => Math.abs(t.area - wanted) <= wanted * 0.15)
      : null) ??
    [...types].sort((a, b) => b.trades - a.trades)[0] ??
    null;
  const points = pick ? txs.filter((t) => t.area_m2 && Math.abs(Number(t.area_m2) - pick.area) <= 3) : txs;
  const s = summarize(points);
  const lines = types.map((t) => ({
    name: `${formatArea(t.area, unit).split(" ")[0]}${t === pick ? " ★" : ""}`,
    points: monthlyRollingMedian(
      sales.filter((x) => Math.abs(Number(x.area_m2) - t.area) <= 0.5).map((x) => ({ date: x.deal_date, value: x.price })),
      { minN: 1 },
    ),
  }));
  const ptype = isPropertyType(c.property_type) ? c.property_type : "apt";
  const address = c.road_address ?? [c.sigungu, c.umd_nm, c.jibun].filter(Boolean).join(" ");
  const all = sp.all === "1";

  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-muted">
          <TypeIcon type={ptype} size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl">{c.name}</h1>
            <Badge>{PROPERTY_TYPES[ptype].label}</Badge>
            {myItemId ? <Badge tone="accent">내 관심 부동산</Badge> : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            {address}
            {c.build_year ? ` · ${c.build_year}년 준공` : ""}
            {c.households ? ` · ${formatNumber(c.households)}세대` : ""}
          </p>
        </div>
        <LinkButton href={mapComplexHref(id)} variant="secondary" className="shrink-0" aria-label="지도">
          <MapIcon size={16} />
          <span className="hidden sm:inline">지도</span>
        </LinkButton>
        {myItemId ? (
          <LinkButton href={`/items/${myItemId}`} className="shrink-0">
            <Star size={16} />
            <span className="hidden sm:inline">내 부동산 보기</span>
          </LinkButton>
        ) : (
          <LinkButton href={registerComplexHref(id)} className="shrink-0">
            <Plus size={16} />
            <span className="hidden sm:inline">관심 등록</span>
          </LinkButton>
        )}
      </div>

      {types.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {types.map((t) => (
            <Link
              key={t.area}
              href={`/complexes/${id}?area=${t.area.toFixed(2)}`}
              scroll={false}
              className={`rounded-full border px-3 py-1 text-xs ${t === pick ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border bg-surface text-muted hover:border-accent"}`}
            >
              {formatArea(t.area, unit).split(" ")[0]} · {t.trades}건
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 text-xs text-muted">{pick ? `전용 ${formatArea(pick.area, unit)} 기준 · 최근 5년 실거래` : "최근 5년 실거래"}</div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="최근 매매"
              value={formatManwon(s.lastSale?.price)}
              sub={s.lastSale ? <span className="text-muted">{formatDate(s.lastSale.deal_date)}{s.lastSale.floor ? ` · ${s.lastSale.floor}층` : ""}</span> : null}
            />
            <Stat label="6개월 중위" value={formatManwon(s.saleMedian6m)} sub={<span className="text-muted">1년 <Change value={s.change1y} /></span>} />
            <Stat
              label={`${unitPriceName(unit)}(6개월)`}
              value={s.saleMedian6m && pick ? formatManwon(perUnitArea(s.saleMedian6m, pick.area, unit)) : "-"}
              sub={<span className="text-muted">전용 {unitPriceLabel(unit)}</span>}
            />
            <Stat label="1년 최고/최저" value={s.high1y ? `${formatManwon(s.high1y, { short: true })} / ${formatManwon(s.low1y, { short: true })}` : "-"} />
            <Stat label="역대 최고가(5년)" value={formatManwon(s.high?.price)} sub={s.high ? <span className="text-muted">{formatDate(s.high.deal_date)}</span> : null} />
            <Stat label="전세가율" value={s.jeonseRatio ? formatPct(s.jeonseRatio, 1, false) : "-"} sub={<span className="text-muted">전세 {formatManwon(s.jeonseMedian6m, { short: true })}</span>} />
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-muted">생활편의 점수</div>
          {loc?.total != null ? (
            <>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="tabular text-3xl font-bold">{Math.round(loc.total)}</span>
                <span className="text-sm text-muted">/ 100</span>
                {loc.percentile !== null ? <Badge tone="accent">주변 {loc.peers}곳 중 상위 {Math.max(1, Math.round((1 - loc.percentile) * 100))}%</Badge> : null}
              </div>
              <ul className="mt-3 space-y-1.5 text-[13px]">
                {ORDER.filter((k) => loc.scores[k]).map((k) => {
                  const cat = loc.scores[k];
                  return (
                    <li key={k} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="font-medium">{cat.label}</span>
                        {cat.details?.[0] ? <span className="block truncate text-xs text-muted">{detailText(cat.details[0])}</span> : null}
                      </span>
                      <span className="tabular shrink-0 font-semibold">{cat.score === null ? "-" : Math.round(cat.score)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">아직 계산되지 않았습니다. 주변 시설 자료는 관심 부동산 근처만 모으므로, 관심 부동산에서 500m 안 단지만 계산됩니다.</p>
          )}
        </Card>

        {zones.length ? (
          <Card className="lg:col-span-3">
            <CardHeader title="정비사업" sub="이 단지가 속하거나 같은 이름인 정비구역" action={<Link href="/projects" className="text-accent">개발·테마</Link>} />
            <ul className="divide-y divide-border px-4 pb-2 text-sm">
              {zones.map((z) => (
                <li key={z.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge tone="accent">{z.kind}</Badge>
                  <Link href={`/projects?zone=${z.id}`} className="min-w-0 flex-1 truncate text-accent">{z.name}</Link>
                  <span className="text-xs">{z.stage ?? "단계 미상"}</span>
                  <span className="flex gap-0.5" aria-label={`${z.stage_order ?? 0}/9 단계`}>
                    {ZONE_STAGES.map((st, i) => (
                      <span key={st} title={st} className={`h-2 w-2 rounded-sm ${i < (z.stage_order ?? 0) ? "bg-accent" : "bg-surface-2"}`} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card className="lg:col-span-3">
          <CardHeader title="실거래가 추이" sub={pick ? `전용 ${formatArea(pick.area, unit).split(" ")[0]} ±3㎡` : "전체 평형"} />
          <div className="px-2 pb-3">
            <PriceHistoryChart points={points} />
          </div>
        </Card>

        {lines.length >= 2 ? (
          <Card className="lg:col-span-3">
            <CardHeader title="평형별 가격 추이" sub="매매 · 3개월 이동 중위 · ★ 선택한 평형" />
            <div className="px-2 pb-3">
              <LineSeriesChart lines={lines} fmt="manwon" height={240} endLabels />
            </div>
          </Card>
        ) : null}

        {c.lng !== null && c.lat !== null ? (
          <Card className="lg:col-span-2">
            <CardHeader title="위치" sub="주변 최근 1년 매매 · 지하철·학교 — 라벨을 누르면 그 단지로" action={<Link href={mapComplexHref(id)} className="text-sm text-accent">큰 지도</Link>} />
            <div className="px-4 pb-4">
              <MiniMap
                keys={{ keyId: env.ncpKeyId ?? null, vworldKey: env.vworldKey ?? null }}
                center={[c.lng, c.lat]}
                radius={1000}
                label={c.name}
                txType={c.property_type}
                selfComplexId={id}
                pnu={c.pnu}
                unit={unit}
                myComplexes={mine}
              />
            </div>
          </Card>
        ) : null}

        <Card className={c.lng !== null ? "" : "lg:col-span-3"}>
          <CardHeader title="이 단지 정보" />
          <dl className="grid grid-cols-2 gap-3 px-4 pb-4 text-sm">
            <Info k="준공" v={c.build_year ? `${c.build_year}년` : "-"} />
            <Info k="세대수" v={c.households ? formatNumber(c.households) : "-"} />
            <Info k="법정동" v={c.umd_nm ?? "-"} />
            <Info k="지번" v={c.jibun ?? "-"} />
            <Info k="5년 거래" v={`${txs.length.toLocaleString()}건`} />
            <Info k="평형" v={`${types.length}종`} />
          </dl>
          {!myItemId ? (
            <p className="border-t border-border px-4 py-3 text-xs text-muted">
              관심 부동산으로 등록하면 추정 시세·알림·뉴스·유사 단지 비교를 받습니다.{" "}
              <Link href={registerComplexHref(id)} className="text-accent">
                등록하기
              </Link>
            </p>
          ) : null}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="거래 내역" sub={`${points.length}건${pick ? ` · 전용 ${formatArea(pick.area, unit).split(" ")[0]}` : ""} · 해제(취소) 거래 포함`} />
          <TxTable rows={[...points].reverse()} discuss limit={all ? 5000 : 30} moreHref={`/complexes/${id}?${pick ? `area=${pick.area.toFixed(2)}&` : ""}all=1`} />
        </Card>

        <div className="lg:col-span-3">
          <BoardTeaser uid={uid} sgg={c.sgg_cd} complexId={c.id} complexName={c.name} />
        </div>
      </div>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="tabular font-medium">{v}</dd>
    </div>
  );
}
