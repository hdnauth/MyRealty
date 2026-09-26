import { Card, CardHeader, Change, Stat } from "@/components/ui";
import { formatDate, formatManwon, formatNumber, formatPct, perPyeong } from "@/lib/format";
import { itemAttrs, itemTransactions, summarize, type WatchItem } from "@/lib/queries/items";
import { AttrsCard } from "./attrs-card";

export async function OverviewTab({ item }: { item: WatchItem }) {
  const [points, attrs] = await Promise.all([itemTransactions(item, 5), itemAttrs(item)]);
  const s = summarize(points);
  const isComplex = Boolean(item.complex_id);
  const area = item.area_m2 ?? item.land_area_m2;
  // 단지형은 같은 단지·면적 6개월 중위, 그 외는 인근 유사 거래 ㎡당 중위 × 내 면적
  const current = isComplex
    ? s.saleMedian6m ?? s.lastSale?.price ?? null
    : s.unitMedian12m && area
      ? Math.round(s.unitMedian12m * area)
      : null;
  const gain = current && item.purchase_price ? current / item.purchase_price - 1 : null;
  const loanTotal = item.loans.reduce((a, l) => a + (l.amount || 0), 0);
  const deposit = item.lease?.role !== "tenant" ? item.lease?.deposit ?? 0 : 0;
  const equity = current ? current - loanTotal - deposit : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-4 lg:col-span-2">
        {isComplex ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="최근 매매"
              value={formatManwon(s.lastSale?.price)}
              sub={s.lastSale ? <span className="text-muted">{formatDate(s.lastSale.deal_date)}{s.lastSale.floor ? ` · ${s.lastSale.floor}층` : ""}</span> : null}
            />
            <Stat label="6개월 중위" value={formatManwon(s.saleMedian6m)} sub={<span className="text-muted">1년 <Change value={s.change1y} /></span>} />
            <Stat label="평당가(6개월)" value={s.saleMedian6m && area ? formatManwon(perPyeong(s.saleMedian6m, area)) : "-"} sub={<span className="text-muted">전용 평당</span>} />
            <Stat label="1년 최고/최저" value={s.high1y ? `${formatManwon(s.high1y, { short: true })} / ${formatManwon(s.low1y, { short: true })}` : "-"} />
            <Stat label="역대 최고가" value={formatManwon(s.high?.price)} sub={s.high ? <span className="text-muted">{formatDate(s.high.deal_date)}</span> : null} />
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
        <CardHeader title="내 자산" sub={item.purchase_price ? (isComplex ? "시세는 6개월 중위 기준" : "시세는 유사 거래 ㎡당 중위 기준(참고용)") : "매입 정보를 입력하면 손익을 계산합니다"} />
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
