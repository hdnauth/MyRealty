import { Map as MapIcon, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceHistoryChart } from "@/components/charts/price-history";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { BoardTeaser } from "@/components/community/board-teaser";
import { TypeIcon } from "@/components/items/item-card";
import { TxTable } from "@/components/items/tx-table";
import { LocBars } from "@/components/map/loc-bars";
import { LocationLoader } from "@/components/map/location-loader";
import { MiniMap } from "@/components/map/mini-map";
import { Badge, Card, CardHeader, Change, LinkButton, Stat } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { pageUser, sessionUserId } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatArea, formatDate, formatManwon, formatNumber, formatPct, perUnitArea, unitPriceLabel, unitPriceName } from "@/lib/format";
import { floorPremiums, jeonseCheck, monthlyRollingMedian } from "@/lib/item-analytics";
import { mapComplexHref, registerComplexHref } from "@/lib/links";
import { isPropertyType, PROPERTY_TYPES } from "@/lib/property";
import { complexLocation, complexTransactions, getComplex } from "@/lib/queries/complexes";
import { ensureComplexScores } from "@/lib/queries/location-live";
import { complexZones } from "@/lib/queries/projects";
import { ZONE_STAGES } from "@/lib/projects";
import { myComplexItems, summarize } from "@/lib/queries/items";
import { clusterAreas } from "@/lib/units";
import { detailText, ORDER } from "../../items/[id]/tabs/location";
import { ExternalLink } from "lucide-react";
import { BriefCard } from "@/components/brief/brief-card";
import { FinanceProfileForm } from "@/components/brief/finance-form";
import { buildBrief, notableSignals, readFinanceProfile } from "@/lib/brief";
import { NotableCard } from "@/components/brief/notable-card";
import { naverLandHref } from "@/lib/links";
import { compsBrief, marketBrief, pointPermit } from "@/lib/queries/brief";
import { sql } from "@/lib/db";

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
  const [viewer, c, unit, mine] = await Promise.all([pageUser(uid), getComplex(id), getAreaUnit(), myComplexItems(uid)]);
  if (!c) notFound();
  const [txs, loc, zones, mkt, permit, [rate]] = await Promise.all([
    complexTransactions(id, 5),
    // 점수가 없고 시설이 갖춰진 단지면 여기서 바로 계산한다(수십 ms). 간이 점수(OSM 보충)는 느려서 화면에서 따로(LocationLoader)
    complexLocation(id).then(async (l) => (l ? l : (await ensureComplexScores([id], { maxFull: 1, maxQuick: 0 }), complexLocation(id)))),
    complexZones(id),
    marketBrief(c.sgg_cd),
    pointPermit(c.lng, c.lat, c.pnu),
    sql<{ value: number }[]>`select value from series_values where code = 'ecos.mortgage_rate' order by period desc limit 1`,
  ]);
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
  // 다섯 질문 요약(관심 등록 전이라 '관심' 관점): 선택한 평형 기준
  const comps = pick ? await compsBrief({ complex_id: id, lng: c.lng, lat: c.lat, radius_m: 1000, area_m2: pick.area }) : { relative: null, compGap: null };
  const profile = readFinanceProfile(viewer?.settings);
  const current = s.saleMedian6m ?? s.lastSale?.price ?? null;
  const answers = buildBrief({
    group: "watch",
    kind: "complex",
    value: { current, basis: "최근 6개월 같은 평형 거래 중위", samples12m: s.count12m },
    change1y: s.change1y,
    fromHigh: current && s.high ? current / s.high.price - 1 : null,
    relative: comps.relative,
    compGap: comps.compGap,
    market: mkt.market,
    rate: rate?.value ?? 4,
    loans: [],
    profile,
    flags: { permit, unregistered: mkt.unregistered, supply: mkt.supply },
  });
  const floors = pick ? floorPremiums(points) : null;
  const contracts = jeonseCheck({ deposit: null, role: null, points });
  const signals = notableSignals({
    floors: floors ? { mine: null, low: floors.bands.find((x) => x.key === "low")?.premium ?? null, high: floors.bands.find((x) => x.key === "high")?.premium ?? null } : null,
    jeonseContracts: { newMedian: contracts.newMedian, renewalMedian: contracts.renewalMedian, newN: contracts.newN, renewalN: contracts.renewalN },
    region: mkt.signals,
  });
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
          // 지도에서 단지를 눌러 들어온 사용자의 다음 행동이라 모바일에서도 글자로 보인다
          <LinkButton href={registerComplexHref(id)} className="shrink-0 px-3">
            <Star size={16} />
            관심 등록
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
              className={`rounded-full border px-3.5 py-1.5 text-sm ${t === pick ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border bg-surface text-muted hover:border-accent"}`}
            >
              {formatArea(t.area, unit).split(" ")[0]} · {t.trades}건
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BriefCard
            answers={answers}
            title="한눈에 보기"
            sub={pick ? `전용 ${formatArea(pick.area, unit).split(" ")[0]} 기준 · 실거래·금리 등 공공데이터로 계산` : "실거래·금리 등 공공데이터로 계산"}
            links={{
              price: "#trend",
              compare: "#trend",
              market: c.sgg_cd ? `/indicators?sgg=${c.sgg_cd}` : "/indicators",
              money: "/settings#finance",
              risk: "#trend",
            }}
            slots={{ "finance-profile": <FinanceProfileForm profile={profile} compact /> }}
            footer="참고 정보이며 투자 권유가 아닙니다."
          />
        </div>
        <Card className="flex flex-col justify-between gap-3 p-4">
          <div>
            <div className="text-xs text-muted">{pick ? `전용 ${formatArea(pick.area, unit)}` : "전체 평형"} · 최근 6개월 거래 중위</div>
            <div className="tabular mt-0.5 text-3xl font-bold tracking-tight">{formatManwon(current)}</div>
            <div className="mt-1 text-sm">1년 <Change value={s.change1y} /></div>
          </div>
          <a href={naverLandHref(c.umd_nm, c.name)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-medium text-accent">
            지금 나온 매물 보기(네이버 부동산) <ExternalLink size={13} />
          </a>
        </Card>

        <NotableCard signals={signals} className="lg:col-span-3" />

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
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">생활편의 점수</span>
            {loc?.basis === "quick" ? <Badge>간이</Badge> : null}
          </div>
          {loc?.total != null ? (
            <>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                <span className="tabular text-3xl font-bold">{Math.round(loc.total)}</span>
                <span className="text-sm text-muted">/ 100</span>
                {loc.percentile !== null ? <Badge tone="accent">주변 {loc.peers}곳 중 상위 {Math.max(1, Math.round((1 - loc.percentile) * 100))}%</Badge> : null}
              </div>
              <LocBars className="mt-3" cats={Object.fromEntries(ORDER.filter((k) => loc.scores[k]).map((k) => [k, loc.scores[k].score]))} />
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-accent">근거 보기</summary>
                <ul className="mt-2 space-y-1.5 text-xs">
                  {ORDER.filter((k) => loc.scores[k]?.details?.[0]).map((k) => (
                    <li key={k}>
                      <span className="font-medium">{loc.scores[k].label}</span>
                      <span className="block text-muted">{detailText(loc.scores[k].details![0])}</span>
                    </li>
                  ))}
                </ul>
              </details>
              {loc.basis === "quick" ? (
                <p className="mt-2 text-xs leading-relaxed text-muted">역·학교·공원·병원·마트와 업무지구 거리로 낸 간이 점수예요. 학원·음식점 등은 다음 매일 수집 뒤 반영됩니다.</p>
              ) : null}
            </>
          ) : loc ? (
            <p className="mt-2 text-sm text-muted">주변 시설 자료가 없어 점수를 내지 못했어요. 매일 아침 수집 뒤 다시 계산합니다.</p>
          ) : c.lng !== null && c.lat !== null ? (
            // 저장된 점수가 없을 때만 — 계산 뒤 다시 그리면 위 분기로 간다
            <LocationLoader complexId={id} />
          ) : (
            <p className="mt-2 text-sm text-muted">위치를 확인하지 못해 계산할 수 없습니다.</p>
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

        <Card id="trend" className="scroll-mt-20 lg:col-span-3">
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
