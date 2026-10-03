"use client";

import clsx from "clsx";
import type { TradePreview } from "@/app/api/address/trades/route";
import { Badge } from "@/components/ui";
import { type AreaUnit, formatDate, formatManwon, formatPct, formatUnitPrice, perUnitArea, unitPriceLabel } from "@/lib/format";
import { DEAL_KIND_LABEL } from "@/lib/property";

/**
 * 등록 화면의 최근 실거래 미리보기. 단지형은 고른 평형 기준(없으면 전체), 그 외는 같은 동네의 비슷한 거래.
 * 수집 전인 단지·지역이면 실거래 API 에서 바로 불러온 값이다(등록 후 개별 수집이 저장한다).
 */
export function TradePreviewCard({
  preview,
  loading,
  area,
  hasComplex,
  unit,
}: {
  preview: TradePreview | null;
  loading: boolean;
  area: number | null;
  hasComplex: boolean;
  unit: AreaUnit;
}) {
  if (loading) return <div className="rounded-lg bg-surface-2 p-3 text-sm text-muted">최근 실거래를 확인하는 중…</div>;
  if (!preview || preview.source === "none") {
    return preview?.note ? <p className="text-xs text-muted">· {preview.note}</p> : null;
  }
  // 평형을 골랐으면 그 평형(±0.5㎡)만
  const inType = (a: number | null) => !hasComplex || !area || (a !== null && Math.abs(a - area) <= 0.5);
  const rows = preview.recent.filter((r) => inType(r.area));
  const sales = rows.filter((r) => r.kind === "sale" && !r.canceled);
  const type = hasComplex && area ? preview.byArea.find((b) => Math.abs(b.area - area) <= 0.5) ?? null : null;
  // 평형을 안 골랐으면 전체 거래 기준
  const med = (xs: number[]) => {
    if (!xs.length) return null;
    const v = [...xs].sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const saleMedian = type ? type.median : med(sales.map((r) => r.price));
  const jeonse = type ? type.jeonseMedian : med(rows.filter((r) => r.kind === "jeonse").map((r) => r.price));
  const shown = rows.slice(0, 6);
  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">최근 실거래</span>
        <span className="text-xs text-muted">
          {hasComplex ? (area ? `같은 단지 · 전용 ${area}㎡` : "같은 단지 · 전체 평형") : preview.basis} · 매매 1년{hasComplex ? "·전월세 6개월" : ""}
        </span>
        <Badge tone={preview.source === "live" ? "accent" : "neutral"}>{preview.source === "live" ? "실거래 API 바로 조회" : "수집된 데이터"}</Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 px-3 py-2 text-center">
        <Mini label={hasComplex ? "매매 중위" : `${unitPriceLabel(unit)} 중위`}>
          {hasComplex ? formatManwon(saleMedian, { short: true }) : formatUnitPrice(perUnitArea(preview.unitMedian, 1, unit))}
        </Mini>
        <Mini label={hasComplex ? "전세 중위" : "매매 건수"}>{hasComplex ? formatManwon(jeonse, { short: true }) : `${preview.sales12m}건`}</Mini>
        <Mini label={hasComplex ? "전세가율" : "최근 거래"}>
          {hasComplex ? (saleMedian && jeonse ? formatPct(jeonse / saleMedian, 0, false) : "-") : formatDate(sales[0]?.date)}
        </Mini>
      </div>
      {shown.length ? (
        <ul className="divide-y divide-border border-t border-border text-xs">
          {shown.map((r, i) => (
            <li key={i} className={clsx("flex justify-between gap-2 px-3 py-1.5 tabular", r.canceled && "text-muted line-through")}>
              <span className="min-w-0 truncate text-muted">
                {formatDate(r.date)} · {DEAL_KIND_LABEL[r.kind]}
                {r.area ? ` · ${Math.round(Number(r.area)).toLocaleString()}㎡` : ""}
                {r.floor ? ` · ${r.floor}층` : ""}
                {!hasComplex && r.name ? ` · ${r.name}` : ""}
              </span>
              <span className="shrink-0 font-medium">
                {formatManwon(r.price, { short: true })}
                {r.rent ? `/${r.rent}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-border px-3 py-2 text-xs text-muted">
          {hasComplex && area ? "이 평형의 최근 거래가 없습니다. 다른 평형 거래는 평형 목록의 가격을 참고하세요." : "최근 1년 신고된 거래가 없습니다."}
        </p>
      )}
      {preview.note ? <p className="border-t border-border px-3 py-1.5 text-[0.75rem] text-muted">{preview.note}</p> : null}
    </div>
  );
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[0.75rem] text-muted">{label}</div>
      <div className="tabular text-sm font-semibold">{children}</div>
    </div>
  );
}
