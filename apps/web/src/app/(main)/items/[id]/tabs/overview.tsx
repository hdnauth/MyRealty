import { Badge, Card, CardHeader, Change, Stat } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { sql } from "@/lib/db";
import { floorBandOf, floorPremiums, jeonseCheck, rateSensitivity } from "@/lib/item-analytics";
import { formatDate, formatManwon, formatNumber, formatPct, perUnitArea, unitPriceLabel, unitPriceName } from "@/lib/format";
import { itemAttrs, itemTransactions, summarize, type WatchItem } from "@/lib/queries/items";
import { AttrsCard } from "./attrs-card";

export async function OverviewTab({ item }: { item: WatchItem }) {
  const [points, attrs, unit, [val], [rate]] = await Promise.all([
    itemTransactions(item, 5),
    itemAttrs(item),
    getAreaUnit(),
    sql<{ estimate: number; low: number | null; high: number | null; confidence: string | null; as_of: string }[]>`
      select estimate, low, high, confidence, as_of::text from valuations where watch_item_id = ${item.id} order by as_of desc limit 1`,
    sql<{ value: number }[]>`select value from series_values where code = 'ecos.mortgage_rate' order by period desc limit 1`,
  ]);
  const s = summarize(points);
  const isComplex = Boolean(item.complex_id);
  const area = item.area_m2 ?? item.land_area_m2;
  // 단지형은 같은 단지·면적 6개월 중위, 그 외는 인근 유사 거래 ㎡당 중위 × 내 면적
  const current =
    val?.estimate ??
    (isComplex
      ? s.saleMedian6m ?? s.lastSale?.price ?? null
      : s.unitMedian12m && area
        ? Math.round(s.unitMedian12m * area)
        : null);
  const fromHigh = current && s.high ? current / s.high.price - 1 : null;
  const floors = isComplex ? floorPremiums(points) : null;
  const myBand = floors ? floorBandOf(item.floor, floors.bands) : null;
  // 금리 민감도: 보유 대출이 있으면 그 대출, 매수 후보면 추정가의 50%를 현재 주담대 금리로
  const loan = item.loans[0];
  const sens = loan?.amount
    ? { title: "내 대출", principal: loan.amount, rate: loan.rate || rate?.value || 4, years: loan.years ?? 30 }
    : item.group_tag === "candidate" && current
      ? { title: "매수 시(추정가의 50% 대출)", principal: Math.round(current * 0.5), rate: rate?.value ?? 4, years: 30 }
      : null;
  const jc = item.lease?.deposit || item.group_tag === "tenant" ? jeonseCheck({ deposit: item.lease?.deposit ?? null, role: item.lease?.role ?? null, points }) : null;
  const gain = current && item.purchase_price ? current / item.purchase_price - 1 : null;
  const loanTotal = item.loans.reduce((a, l) => a + (l.amount || 0), 0);
  const deposit = item.lease?.role !== "tenant" ? item.lease?.deposit ?? 0 : 0;
  const equity = current ? current - loanTotal - deposit : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-4 lg:col-span-2">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="text-xs text-muted">{val ? "추정 시세" : isComplex ? "현재 시세(6개월 중위)" : "추정가(유사 거래 기준)"}</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="tabular text-3xl font-bold tracking-tight">{formatManwon(current)}</span>
              {val?.confidence ? <Badge tone={val.confidence === "high" ? "accent" : "neutral"}>신뢰도 {CONF[val.confidence] ?? val.confidence}</Badge> : null}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {val?.low && val.high ? `범위 ${formatManwon(val.low, { short: true })} ~ ${formatManwon(val.high, { short: true })} · ` : ""}
              {val ? `${formatDate(val.as_of)} 기준 · 실거래·유사 단지로 계산` : `최근 거래 ${s.count12m}건 기준`}
            </div>
          </div>
          <div className="flex gap-5 text-right text-sm">
            <div>
              <div className="text-xs text-muted">1년</div>
              <Change value={s.change1y} />
            </div>
            <div>
              <div className="text-xs text-muted">전고점 대비</div>
              <Change value={fromHigh} />
            </div>
            {myBand?.premium != null ? (
              <div>
                <div className="text-xs text-muted">내 층({myBand.label})</div>
                <Change value={myBand.premium} />
              </div>
            ) : null}
          </div>
        </div>
        {isComplex ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="최근 매매"
              value={formatManwon(s.lastSale?.price)}
              sub={s.lastSale ? <span className="text-muted">{formatDate(s.lastSale.deal_date)}{s.lastSale.floor ? ` · ${s.lastSale.floor}층` : ""}</span> : null}
            />
            <Stat label="6개월 중위" value={formatManwon(s.saleMedian6m)} sub={<span className="text-muted">1년 <Change value={s.change1y} /></span>} />
            <Stat label={`${unitPriceName(unit)}(6개월)`} value={s.saleMedian6m && area ? formatManwon(perUnitArea(s.saleMedian6m, area, unit)) : "-"} sub={<span className="text-muted">전용 {unitPriceLabel(unit)}</span>} />
            <Stat label="1년 최고/최저" value={s.high1y ? `${formatManwon(s.high1y, { short: true })} / ${formatManwon(s.low1y, { short: true })}` : "-"} />
            <Stat
              label="역대 최고가"
              value={formatManwon(s.high?.price)}
              sub={
                s.high ? (
                  <span className="text-muted">
                    {formatDate(s.high.deal_date)}
                    {current ? <> · 현재 <Change value={current / s.high.price - 1} /></> : null}
                  </span>
                ) : null
              }
            />
            <Stat label="전세가율" value={s.jeonseRatio ? formatPct(s.jeonseRatio, 1, false) : "-"} sub={<span className="text-muted">전세 {formatManwon(s.jeonseMedian6m, { short: true })}</span>} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="추정가(유사 거래 기준)" value={formatManwon(current)} sub={<span className="text-muted">㎡당 중위 × {area ? `${Number(area).toLocaleString()}㎡` : "면적 미입력"}</span>} />
            <Stat
              label="㎡당 중위(12개월)"
              value={s.unitMedian12m ? `${formatNumber(s.unitMedian12m * 10000)}원` : "-"}
              sub={<span className="text-muted">평당 {s.unitMedian12m ? formatManwon(s.unitMedian12m * 3.305785, { short: true }) : "-"}</span>}
            />
            <Stat label="유사 거래(12개월)" value={`${s.count12m}건`} sub={<span className="text-muted">1년 <Change value={s.change1y} /></span>} />
            <Stat
              label="가장 최근 유사 거래"
              value={formatManwon(s.lastSale?.price, { short: true })}
              sub={s.lastSale ? <span className="text-muted">{formatDate(s.lastSale.deal_date)} · {s.lastSale.area_m2 ? `${Number(s.lastSale.area_m2).toLocaleString()}㎡` : ""}</span> : null}
            />
          </div>
        )}
        <p className="mt-4 text-xs text-muted">
          최근 3개월 매매 {s.count3m}건 · 실거래 신고 기한(30일)으로 최근 1~2개월은 집계 중일 수 있습니다.
        </p>
      </Card>

      <Card>
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
        </div>
      </Card>

      {floors ? (
        <Card>
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
      ) : null}

      {sens ? (
        <Card>
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
      ) : null}

      {jc ? (
        <Card>
          <CardHeader
            title={item.lease?.role === "tenant" || item.group_tag === "tenant" ? "내 보증금 점검" : "역전세 점검"}
            sub="이 단지·평형 전세 실거래 기준"
            action={jc.level !== "판단불가" ? <Badge tone={jc.level === "양호" ? "ok" : jc.level === "주의" ? "warn" : "up"}>{jc.level}</Badge> : null}
          />
          <div className="space-y-2 px-4 pb-4 text-sm">
            <Row k="현재 전세 시세(6개월)" v={formatManwon(jc.current)} sub={jc.samples ? `${jc.samples}건` : undefined} />
            <Row k="2년 전 전세 시세" v={formatManwon(jc.twoYearsAgo)} sub={jc.trend !== null ? formatPct(jc.trend) : undefined} />
            <Row k={item.lease?.role === "tenant" ? "내 보증금" : "받은 보증금"} v={formatManwon(item.lease?.deposit ?? null)} sub={item.lease?.end_date ? `만기 ${formatDate(item.lease.end_date)}` : undefined} />
            {jc.gap !== null ? (
              <p className="border-t border-border pt-2 text-[13px] leading-relaxed">
                {jc.gap >= 0
                  ? `지금 시세가 보증금보다 ${formatManwon(jc.gap, { short: true })} 높습니다.`
                  : item.lease?.role === "tenant"
                    ? `지금 전세 시세가 내 보증금보다 ${formatManwon(-jc.gap, { short: true })} 낮습니다. 만기에 집주인이 새 세입자 보증금만으로 돌려주기 어려울 수 있으니 반환 계획을 미리 확인하세요.`
                    : `지금 시세로 새 세입자를 받으면 약 ${formatManwon(-jc.gap, { short: true })}을 따로 마련해 돌려줘야 합니다.`}
              </p>
            ) : (
              <p className="text-xs text-muted">보증금을 입력하면(수정 › 매입·대출·임대) 시세와 비교합니다.</p>
            )}
          </div>
        </Card>
      ) : null}

      <AttrsCard item={item} attrs={attrs} marketPrice={current} />

      {item.complex_name ? (
        <Card className="p-4 lg:col-span-3">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat label="단지" value={item.complex_name} />
            <Stat label="준공" value={item.complex_build_year ? `${item.complex_build_year}년` : "-"} />
            <Stat label="세대수" value={item.complex_households ? item.complex_households.toLocaleString() : "-"} />
            <Stat label="법정동" value={item.umd_nm ?? "-"} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

const CONF: Record<string, string> = { high: "높음", medium: "보통", low: "낮음" };

function Row({ k, v, sub, tone, strong }: { k: string; v: string; sub?: string; tone?: number | null; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted">{k}</span>
      <span className={`tabular ${strong ? "text-base font-bold" : "font-medium"} ${tone ? (tone > 0 ? "text-up" : "text-down") : ""}`}>
        {v}
        {sub ? <span className="ml-1 text-xs font-normal text-muted">{sub}</span> : null}
      </span>
    </div>
  );
}
