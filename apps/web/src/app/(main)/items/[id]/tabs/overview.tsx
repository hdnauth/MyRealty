import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BriefCard } from "@/components/brief/brief-card";
import { FinanceProfileForm } from "@/components/brief/finance-form";
import { MiniMap } from "@/components/map/mini-map";
import { Badge, Card, CardHeader, Change, Stat } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { affordability, buildBrief, type FinanceProfile, isItemGroup, type ItemGroup, notableSignals } from "@/lib/brief";
import { NotableCard } from "@/components/brief/notable-card";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { jeonseRisk } from "@/lib/finance";
import { formatDate, formatManwon, formatNumber, formatPct, perUnitArea, unitPriceLabel, unitPriceName } from "@/lib/format";
import { floorBandOf, floorPremiums, jeonseCheck, rateSensitivity } from "@/lib/item-analytics";
import { naverLandHref } from "@/lib/links";
import { PROPERTY_TYPES } from "@/lib/property";
import { compsBrief, marketBrief, officialPriceOf } from "@/lib/queries/brief";
import { itemAttrs, itemTransactions, myComplexItems, summarize, type WatchItem } from "@/lib/queries/items";
import { itemRegulation } from "@/lib/queries/projects";
import { redevelopmentInfo } from "@/lib/queries/special";
import type { ViewMode } from "@/lib/view-mode";
import { AiCard } from "./analysis";
import { AttrsCard } from "./attrs-card";
import { RedevelopmentCard } from "./redevelopment-card";

/** 추정 시세 근거(valuations.method) */
function valBasis(method: string) {
  const [base, scope] = method.split(":");
  if (base === "same_complex" && scope === "guessed_area") return "같은 단지 거래로 계산(평형 미선택 — 가장 많이 거래된 평형)";
  return (
    { same_complex: "같은 단지 거래로 계산", neighbor_complexes: "인근 유사 단지로 계산", hedonic: "지역 거래 회귀로 계산", land_unit_median: "비슷한 크기 토지 거래로 계산" }[base] ??
    "실거래로 계산"
  );
}

const CONF: Record<string, string> = { high: "높음", medium: "보통", low: "낮음" };

/** 요약 카드 아래 근거 카드 순서(모두 같음). 넣은 정보·데이터가 없는 카드는 건너뛴다 */
const CARD_ORDER = ["jeonse", "assets", "afford", "rate", "floors", "reg", "redev", "attrs", "ai", "map", "complex"];

/**
 * 요약 탭: 다섯 질문 답 → 시세 카드 → 눈여겨볼 지표 → 근거 카드.
 * viewing: 평형 막대에서 다른 평형을 '보기만' 하는 중(추정 시세는 저장된 내 평형 기준이라 쓰지 않는다)
 */
export async function OverviewTab({ item, viewing = false, mode, profile }: { item: WatchItem; viewing?: boolean; mode: ViewMode; profile: FinanceProfile | null }) {
  const isComplex = Boolean(item.complex_id);
  const [points, attrs, unit, [valSaved], [prevVal], [rate], redev, mine, reg, mkt, comps] = await Promise.all([
    itemTransactions(item, 5),
    itemAttrs(item),
    getAreaUnit(),
    sql<{ estimate: number; low: number | null; high: number | null; confidence: string | null; as_of: string; method: string }[]>`
      select estimate, low, high, confidence, as_of::text, method from valuations where watch_item_id = ${item.id} order by as_of desc limit 1`,
    sql<{ estimate: number }[]>`
      select estimate from valuations where watch_item_id = ${item.id} and as_of <= current_date - 80 order by as_of desc limit 1`,
    sql<{ value: number }[]>`select value from series_values where code = 'ecos.mortgage_rate' order by period desc limit 1`,
    redevelopmentInfo(item),
    myComplexItems(item.user_id),
    itemRegulation(item.id),
    marketBrief(item.sgg_cd),
    isComplex ? compsBrief(item) : Promise.resolve({ relative: null, compGap: null, comps: 0 }),
  ]);
  const group: ItemGroup = isItemGroup(item.group_tag) ? item.group_tag : "watch";
  const val = viewing ? undefined : valSaved;
  const s = summarize(points, new Date(), { perArea: !isComplex });
  const area = item.area_m2 ?? item.land_area_m2;
  const mortgage = rate?.value ?? 4;
  // 단지형은 같은 단지·면적 6개월 중위, 그 외는 인근 유사 거래 ㎡당 중위 × 내 면적
  const current =
    val?.estimate ??
    (isComplex ? (s.saleMedian6m ?? s.lastSale?.price ?? null) : s.unitMedian12m && area ? Math.round(s.unitMedian12m * area) : null);
  const isLandType = item.property_type === "land" || item.property_type === "forest";
  const lastLandPrice = attrs.prices.filter((p) => p.target_type === "land").at(-1);
  // 공시지가(원/㎡) × 면적 → 만원
  const officialTotal = lastLandPrice && area ? (lastLandPrice.price * Number(area)) / 10000 : null;
  // 전고점 대비는 같은 단지·평형일 때만 의미가 있다(토지·단독은 거래마다 다른 필지·건물)
  const fromHigh = isComplex && current && s.high ? current / s.high.price - 1 : null;
  const floors = isComplex ? floorPremiums(points) : null;
  const myBand = floors ? floorBandOf(item.floor, floors.bands) : null;
  const tenantRole = item.lease?.role === "tenant" || group === "tenant";
  // 신규·갱신 전세 중위는 보증금과 상관없이 단지형이면 계산한다(눈여겨볼 지표)
  const contracts = isComplex ? jeonseCheck({ deposit: null, role: null, points }) : null;
  const jc = item.lease?.deposit || group === "tenant" ? jeonseCheck({ deposit: item.lease?.deposit ?? null, role: item.lease?.role ?? null, points }) : null;
  const official = officialPriceOf(attrs, item.dong_ho);
  const lease = item.lease?.deposit ? { deposit: item.lease.deposit, role: item.lease.role ?? (group === "tenant" ? "tenant" : "landlord"), endDate: item.lease.end_date } : null;
  const valueBasis = val ? `추정 시세 · ${valBasis(val.method)}` : isComplex ? "최근 6개월 같은 평형 거래 중위" : "주변 비슷한 거래 ㎡당 중위 × 내 면적";

  const answers = buildBrief({
    group,
    kind: isComplex ? "complex" : "parcel",
    value: { current, low: val?.low, high: val?.high, confidence: val?.confidence, basis: valueBasis, samples12m: s.count12m },
    change1y: s.change1y,
    fromHigh,
    purchasePrice: item.purchase_price,
    relative: comps.relative,
    compGap: comps.compGap,
    officialMultiple: isLandType && officialTotal && current ? current / officialTotal : null,
    market: mkt.market,
    rate: mortgage,
    loans: item.loans.map((l) => ({ amount: l.amount, rate: l.rate, years: l.years })),
    lease: lease ? { ...lease, role: lease.role === "tenant" ? "tenant" : "landlord" } : null,
    profile,
    jeonse: jc ? { current: jc.current, gap: jc.gap, level: jc.level } : null,
    saleValue: isComplex ? (s.saleMedian6m ?? current) : current,
    official,
    flags: { permit: reg?.permit, unregistered: mkt.unregistered, supply: mkt.supply },
  });

  const signals = notableSignals({
    floors: floors
      ? {
          mine: myBand && myBand.premium !== null ? { label: myBand.label, premium: myBand.premium, n: myBand.n } : null,
          low: floors.bands.find((x) => x.key === "low")?.premium ?? null,
          high: floors.bands.find((x) => x.key === "high")?.premium ?? null,
        }
      : null,
    jeonseContracts: contracts ? { newMedian: contracts.newMedian, renewalMedian: contracts.renewalMedian, newN: contracts.newN, renewalN: contracts.renewalN } : null,
    region: mkt.signals,
  });

  const base = `/items/${item.id}`;
  const links = {
    price: `${base}?tab=price`,
    compare: `${base}?tab=price#compare`,
    market: item.sgg_cd ? `/indicators?sgg=${item.sgg_cd}` : "/indicators",
    money: "#money",
    risk: "#risk",
    edit: `${base}/edit`,
  };

  // ── 근거 카드 ──
  const loan = item.loans[0];
  const afford = (group === "candidate" || group === "watch") && current && profile?.cash != null
    ? affordability({ price: current, cash: profile.cash, income: profile.income, ltv: profile.ltv, rate: mortgage })
    : null;
  // 금리 민감도: 보유 대출이 있으면 그 대출, 매수 후보면 필요한 대출(자금 정보가 없으면 추정가의 50%)
  const sens = loan?.amount
    ? { title: "내 대출", principal: loan.amount, rate: loan.rate || mortgage, years: loan.years ?? 30 }
    : group === "candidate" && current
      ? afford && afford.need > 0
        ? { title: "필요한 대출", principal: Math.round(afford.need), rate: mortgage, years: 30 }
        : afford
          ? null
          : { title: "매수 시(추정가의 50% 대출)", principal: Math.round(current * 0.5), rate: mortgage, years: 30 }
      : null;
  const gain = current && item.purchase_price ? current / item.purchase_price - 1 : null;
  const loanTotal = item.loans.reduce((a, l) => a + (l.amount || 0), 0);
  const deposit = item.lease?.role !== "tenant" ? (item.lease?.deposit ?? 0) : 0;
  const equity = current ? current - loanTotal - deposit : null;
  const kk = tenantRole && item.lease?.deposit ? jeonseRisk({ deposit: item.lease.deposit, marketPrice: isComplex ? (s.saleMedian6m ?? current) : current, officialPrice: official }) : null;
  const naver = isComplex && item.complex_name ? naverLandHref(item.umd_nm, item.complex_name) : null;
  // 위험 근거 앵커: 보증금 점검이 있으면 그 카드, 없으면 규제 카드
  const riskOn = jc ? "jeonse" : reg ? "reg" : null;

  const cards: Record<string, ReactNode> = {
    assets:
      group === "owned" || item.purchase_price ? (
        <Card key="assets">
          <CardHeader title="내 자산" sub={item.purchase_price ? (val ? "시세는 추정 시세 기준" : isComplex ? "시세는 6개월 중위 기준" : "시세는 유사 거래 ㎡당 중위 기준(참고용)") : "매입 정보를 입력하면 손익을 계산합니다"} />
          <div className="space-y-2 px-4 pb-4 text-sm">
            <Row k="매입가" v={formatManwon(item.purchase_price)} sub={item.purchase_date ? formatDate(item.purchase_date, "long") : undefined} />
            <Row k="현재 시세" v={formatManwon(current)} />
            <Row k="평가 손익" v={gain !== null && current && item.purchase_price ? formatManwon(current - item.purchase_price) : "-"} tone={gain} />
            <Row k="대출" v={formatManwon(loanTotal || null)} sub={item.loans[0] ? `${item.loans[0].rate}%` : undefined} />
            {item.lease ? <Row k={item.lease.role === "tenant" ? "내 보증금" : "임대보증금"} v={formatManwon(item.lease.deposit)} sub={item.lease.end_date ? `만기 ${formatDate(item.lease.end_date)}` : undefined} /> : null}
            <div className="border-t border-border pt-2">
              <Row k="순자산(추정)" v={formatManwon(equity)} strong />
            </div>
            {!item.purchase_price ? <Link href={`${base}/edit`} className="block pt-1 text-xs text-accent">매입·대출 정보 입력 →</Link> : null}
          </div>
        </Card>
      ) : null,
    afford:
      group === "candidate" || (group === "watch" && profile) ? (
        <Card key="afford" id="money" className="scroll-mt-20 lg:col-span-2">
          <CardHeader title="내 자금으로 살 수 있나" sub={current ? `이 집 ${formatManwon(current, { short: true })} 기준 · 주담대 평균 ${mortgage.toFixed(2)}% · 30년 원리금균등` : "시세가 나오면 계산합니다"} />
          {afford ? (
            <div className="px-4 pb-2 text-sm">
              <div className="space-y-1.5">
                <Row k="집값" v={formatManwon(afford.price)} />
                <Row k={`부대비용(취득세·중개보수 약 ${formatPct(afford.costRate, 1, false)})`} v={formatManwon(afford.costs)} />
                <Row k="가용 현금" v={`− ${formatManwon(afford.cash)}`} />
                <div className="border-t border-border pt-1.5">
                  <Row k="필요한 대출" v={formatManwon(afford.need)} strong />
                </div>
                <Row k={`LTV ${Math.round(profile!.ltv * 100)}% 한도`} v={formatManwon(afford.ltvCap)} />
                <Row k="DSR 40% 한도" v={afford.dsrCap !== null ? formatManwon(afford.dsrCap) : "연소득 필요"} />
                <Row k="월 상환" v={formatManwon(Math.round(afford.monthly))} sub={afford.incomeShare !== null ? `소득의 ${formatPct(afford.incomeShare, 0, false)}` : undefined} />
              </div>
              <p className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${afford.ok ? "bg-ok/10 text-ok" : "bg-up/10 text-up"}`}>
                {afford.need === 0 ? "가진 현금으로 살 수 있어요." : afford.ok ? `대출 한도(약 ${formatManwon(afford.cap, { short: true })}) 안이에요.` : `한도보다 약 ${formatManwon(afford.short, { short: true })} 많이 필요해요. 이 조건이면 약 ${formatManwon(afford.maxPrice, { short: true })}까지 살 수 있어요.`}
              </p>
              <p className="mt-2 text-[11px] text-muted">개략 계산입니다. 스트레스 DSR·지역별 대출 한도 규제·기존 대출은 반영하지 않았습니다. 실제 한도는 은행에서 확인하세요.</p>
            </div>
          ) : null}
          <div className="px-4 pb-4 pt-2">
            <details open={!profile} className="group">
              <summary className="cursor-pointer text-sm font-medium text-accent">{profile ? "자금 정보 바꾸기" : "자금 정보 넣기"}</summary>
              <div className="mt-3">
                <FinanceProfileForm profile={profile} />
              </div>
            </details>
          </div>
        </Card>
      ) : null,
    rate: sens ? (
      <Card key="rate" id={group === "owned" ? "money" : undefined} className="scroll-mt-20">
        <CardHeader title="금리가 바뀌면" sub={`${sens.title} ${formatManwon(sens.principal, { short: true })} · ${sens.years}년 원리금균등`} />
        <table className="w-full text-sm">
          <tbody className="tabular">
            {rateSensitivity(sens.principal, sens.rate, sens.years).map((r) => (
              <tr key={r.delta} className={`border-t border-border/60 ${r.delta === 0 ? "bg-accent-soft/60 font-semibold" : ""}`}>
                <td className="px-4 py-1.5 text-muted">{r.delta === 0 ? "현재" : `${r.delta > 0 ? "+" : ""}${r.delta}%p`}</td>
                <td className="py-1.5 text-right">{r.rate.toFixed(2)}%</td>
                <td className="py-1.5 text-right">월 {formatManwon(Math.round(r.monthly))}</td>
                <td className={`px-4 py-1.5 text-right ${r.diff > 0 ? "text-up" : r.diff < 0 ? "text-down" : "text-muted"}`}>
                  {r.delta === 0 ? "-" : `${r.diff > 0 ? "+" : ""}${formatManwon(Math.round(r.diff))}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-muted">{loan?.amount ? "대출 금리" : "현재 주담대(신규) 평균 금리"} 기준. 변동금리는 보통 6~12개월마다 바뀝니다.</p>
      </Card>
    ) : null,
    jeonse: jc ? (
      <Card key="jeonse" id={riskOn === "jeonse" ? "risk" : undefined} className="scroll-mt-20">
        <CardHeader
          title={tenantRole ? "내 보증금 점검" : "역전세 점검"}
          sub="이 단지·평형 전세 실거래 기준"
          action={jc.level !== "판단불가" ? <Badge tone={jc.level === "양호" ? "ok" : jc.level === "주의" ? "warn" : "up"}>{jc.level}</Badge> : null}
        />
        <div className="space-y-2 px-4 pb-4 text-sm">
          <Row k="현재 전세 시세(6개월)" v={formatManwon(jc.current)} sub={jc.samples ? `${jc.samples}건` : undefined} />
          <Row k="2년 전 전세 시세" v={formatManwon(jc.twoYearsAgo)} sub={jc.trend !== null ? formatPct(jc.trend) : undefined} />
          {jc.newMedian && jc.renewalMedian ? (
            <Row k="신규 / 갱신 계약" v={`${formatManwon(jc.newMedian, { short: true })} / ${formatManwon(jc.renewalMedian, { short: true })}`} sub={formatPct(jc.newMedian / jc.renewalMedian - 1)} />
          ) : null}
          <Row k={tenantRole ? "내 보증금" : "받은 보증금"} v={formatManwon(item.lease?.deposit ?? null)} sub={item.lease?.end_date ? `만기 ${formatDate(item.lease.end_date)}` : undefined} />
          {kk ? (
            <>
              <Row k="보증금 ÷ 매매 시세" v={kk.ratio !== null ? formatPct(kk.ratio, 0, false) : "-"} sub={kk.ratio !== null ? (kk.ratio >= 0.9 ? "위험" : kk.ratio >= 0.8 ? "주의" : "안전 범위") : undefined} />
              <Row k="전세보증보험 한도(공시가격×126%)" v={kk.cap !== null ? formatManwon(kk.cap, { short: true }) : "공시가격 없음"} sub={kk.overCap !== null && kk.overCap > 0 ? `${formatManwon(kk.overCap, { short: true })} 초과` : undefined} />
            </>
          ) : null}
          {jc.gap !== null ? (
            <p className="border-t border-border pt-2 text-[13px] leading-relaxed">
              {jc.gap >= 0
                ? `지금 시세가 보증금보다 ${formatManwon(jc.gap, { short: true })} 높습니다.`
                : tenantRole
                  ? `지금 전세 시세가 내 보증금보다 ${formatManwon(-jc.gap, { short: true })} 낮습니다. 만기에 집주인이 새 세입자 보증금만으로 돌려주기 어려울 수 있으니 반환 계획을 미리 확인하세요.`
                  : `지금 시세로 새 세입자를 받으면 약 ${formatManwon(-jc.gap, { short: true })}을 따로 마련해 돌려줘야 합니다.`}
            </p>
          ) : (
            <p className="text-xs text-muted">
              보증금을 입력하면 시세와 비교합니다. <Link href={`${base}/edit`} className="text-accent">보증금 입력 →</Link>
            </p>
          )}
          {tenantRole ? <p className="text-[11px] text-muted">등기부등본의 선순위 채권(근저당)은 반영하지 않았습니다. 계약 전 반드시 확인하세요.</p> : null}
        </div>
      </Card>
    ) : null,
    reg: reg ? (
      <Card key="reg" id={riskOn === "reg" ? "risk" : undefined} className="scroll-mt-20 lg:col-span-3">
        <CardHeader title="규제·계획 구역" sub="토지이용계획·구역 경계 기준" action={<Link href="/projects?tab=regulation" className="text-accent">규제 테마</Link>} />
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {reg.permit ? <Badge tone="up">토지거래허가구역</Badge> : null}
          {reg.district_plan ? <Badge tone="accent">지구단위계획구역</Badge> : null}
        </div>
        <p className="px-4 pb-4 text-[13px] leading-relaxed">
          {reg.permit ? "토지거래허가구역입니다. 일정 면적 이상을 살 때 시군구청 허가가 필요하고, 주택은 실거주 목적만 허가돼 전세를 낀 매수가 어렵습니다. " : ""}
          {reg.district_plan ? "지구단위계획구역은 건축물 용도·높이·용적률이 계획으로 정해져 있어 재건축·신축 때 계획 내용을 확인해야 합니다." : ""}
        </p>
      </Card>
    ) : null,
    floors: floors ? (
      <Card key="floors">
        <CardHeader title="층별 가격 차이" sub={`최근 3년 같은 평형 거래 · 같은 시기 거래 대비 · 최고 ${floors.maxFloor}층`} />
        <ul className="space-y-2 px-4 pb-4 text-sm">
          {floors.bands.map((b) => (
            <li key={b.key} className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${myBand?.key === b.key ? "bg-accent-soft" : ""}`}>
              <span>
                <b>{b.label}</b> <span className="text-muted">{b.range} · {b.n}건</span>
                {myBand?.key === b.key ? <span className="ml-1 text-xs text-accent">내 층</span> : null}
              </span>
              {b.premium === null ? <span className="text-muted">표본 부족</span> : <Change value={b.premium} />}
            </li>
          ))}
        </ul>
      </Card>
    ) : null,
    redev: redev ? <RedevelopmentCard key="redev" info={redev} price={current} unit={unit} itemId={item.id} /> : null,
    attrs: <AttrsCard key="attrs" item={item} attrs={attrs} marketPrice={current} />,
    ai: <AiCard key="ai" item={item} />,
    map:
      item.lng !== null && item.lat !== null ? (
        <Card key="map" className="lg:col-span-2">
          <CardHeader title="주변 한눈에" sub="탐색 반경 · 주변 최근 1년 매매 · 지하철·학교" action={<Link href={`/map?item=${item.id}`} className="text-accent">큰 지도</Link>} />
          <div className="px-4 pb-4">
            <MiniMap
              keys={{ keyId: env.ncpKeyId ?? null, vworldKey: env.vworldKey ?? null }}
              center={[item.lng, item.lat]}
              radius={item.radius_m}
              label={item.label}
              txType={PROPERTY_TYPES[item.property_type].tx}
              selfComplexId={item.complex_id}
              pnu={item.pnu}
              myComplexes={mine}
              unit={unit}
            />
          </div>
        </Card>
      ) : null,
    complex: item.complex_name ? (
      <Card key="complex" className="p-4 lg:col-span-3">
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Stat label="단지" value={item.complex_name} />
          <Stat label="준공" value={item.complex_build_year ? `${item.complex_build_year}년` : "-"} />
          <Stat label="세대수" value={item.complex_households ? item.complex_households.toLocaleString() : "-"} />
          <Stat label="법정동" value={item.umd_nm ?? "-"} />
        </div>
      </Card>
    ) : null,
  };

  const stats = isComplex ? (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Stat label="최근 매매" value={formatManwon(s.lastSale?.price)} sub={s.lastSale ? <span className="text-muted">{formatDate(s.lastSale.deal_date)}{s.lastSale.floor ? ` · ${s.lastSale.floor}층` : ""}</span> : null} />
      <Stat label="6개월 중위" value={formatManwon(s.saleMedian6m)} sub={<span className="text-muted">1년 <Change value={s.change1y} /></span>} />
      <Stat label={`${unitPriceName(unit)}(6개월)`} value={s.saleMedian6m && area ? formatManwon(perUnitArea(s.saleMedian6m, area, unit)) : "-"} sub={<span className="text-muted">전용 {unitPriceLabel(unit)}</span>} />
      <Stat label="1년 최고/최저" value={s.high1y ? `${formatManwon(s.high1y, { short: true })} / ${formatManwon(s.low1y, { short: true })}` : "-"} />
      <Stat label="역대 최고가" value={formatManwon(s.high?.price)} sub={s.high ? <span className="text-muted">{formatDate(s.high.deal_date)}</span> : null} />
      <Stat label="전세가율" value={s.jeonseRatio ? formatPct(s.jeonseRatio, 1, false) : "-"} sub={<span className="text-muted">전세 {formatManwon(s.jeonseMedian6m, { short: true })}</span>} />
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {isLandType && officialTotal ? (
        <Stat label="공시지가 대비" value={current ? `${(current / officialTotal).toFixed(2)}배` : "-"} sub={<span className="text-muted">공시지가 총액 {formatManwon(officialTotal, { short: true })}</span>} />
      ) : (
        <Stat label="㎡당 중위 × 내 면적" value={s.unitMedian12m && area ? formatManwon(Math.round(s.unitMedian12m * Number(area))) : "-"} sub={<span className="text-muted">{area ? `${Number(area).toLocaleString()}㎡ · 크기 차이 미보정` : "면적 미입력"}</span>} />
      )}
      <Stat label="㎡당 중위(12개월)" value={s.unitMedian12m ? `${formatNumber(s.unitMedian12m * 10000)}원` : "-"} sub={<span className="text-muted">평당 {s.unitMedian12m ? formatManwon(s.unitMedian12m * 3.305785, { short: true }) : "-"}</span>} />
      <Stat label="유사 거래(12개월)" value={`${s.count12m}건`} sub={<span className="text-muted">1년 <Change value={s.change1y} /></span>} />
      <Stat label="가장 최근 유사 거래" value={formatManwon(s.lastSale?.price, { short: true })} sub={s.lastSale ? <span className="text-muted">{formatDate(s.lastSale.deal_date)} · {s.lastSale.area_m2 ? `${Number(s.lastSale.area_m2).toLocaleString()}㎡` : ""}</span> : null} />
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <BriefCard
          answers={answers}
          links={links}
          title="한눈에 보기"
          sub="실거래·공시가격·금리 등 공공데이터로 계산 — 근거를 눌러 숫자를 확인하세요"
          slots={{ "finance-profile": <FinanceProfileForm profile={profile} compact /> }}
          footer="참고 정보이며 투자 권유가 아닙니다."
        />
      </div>

      <Card className="p-4">
        <div className="text-xs text-muted">{val ? "추정 시세" : isComplex ? "현재 시세(6개월 중위)" : "추정가(유사 거래 기준)"}</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
          <span className="tabular text-3xl font-bold tracking-tight">{formatManwon(current)}</span>
          {val?.confidence ? <Badge tone={val.confidence === "high" ? "accent" : "neutral"}>신뢰도 {CONF[val.confidence] ?? val.confidence}</Badge> : null}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {val?.low && val.high ? `범위 ${formatManwon(val.low, { short: true })} ~ ${formatManwon(val.high, { short: true })} · ` : ""}
          {val ? `${formatDate(val.as_of)} 기준 · ${valBasis(val.method)}` : `최근 1년 거래 ${s.count12m}건 기준`}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <div>
            <div className="text-xs text-muted">1년</div>
            <Change value={s.change1y} />
          </div>
          {fromHigh !== null ? (
            <div>
              <div className="text-xs text-muted">전고점 대비</div>
              <Change value={fromHigh} />
            </div>
          ) : null}
          {prevVal && val ? (
            <div>
              <div className="text-xs text-muted">3개월 전 추정 대비</div>
              <Change value={val.estimate / prevVal.estimate - 1} />
            </div>
          ) : null}
          {myBand?.premium != null ? (
            <div>
              <div className="text-xs text-muted">내 층({myBand.label})</div>
              <Change value={myBand.premium} />
            </div>
          ) : null}
        </div>
        {naver ? (
          <a href={naver} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-1 text-sm font-medium text-accent">
            지금 나온 매물 보기(네이버 부동산) <ExternalLink size={13} />
          </a>
        ) : null}
        <details open={mode === "pro"} className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium text-muted">숫자 더 보기</summary>
          <div className="mt-3">{stats}</div>
          <p className="mt-3 text-xs text-muted">최근 3개월 매매 {s.count3m}건 · 실거래 신고 기한(30일)으로 최근 1~2개월은 집계 중일 수 있습니다. 추정 시세는 감정평가가 아닙니다.</p>
        </details>
      </Card>

      <NotableCard signals={signals} className="lg:col-span-3" />

      {CARD_ORDER.map((k) => cards[k]).filter(Boolean)}
    </div>
  );
}

function Row({ k, v, sub, tone, strong }: { k: string; v: string; sub?: string; tone?: number | null; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted">{k}</span>
      <span className={`tabular text-right ${strong ? "text-base font-bold" : "font-medium"} ${tone ? (tone > 0 ? "text-up" : "text-down") : ""}`}>
        {v}
        {sub ? <span className="ml-1 text-xs font-normal text-muted">{sub}</span> : null}
      </span>
    </div>
  );
}
