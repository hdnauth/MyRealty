"use client";

import clsx from "clsx";
import { useState } from "react";
import { type AreaUnit, formatArea, formatDate, formatManwon, formatPct, perUnitArea, unitPriceLabel } from "@/lib/format";
import type { DealKind } from "@/lib/map-filters";
import { DEAL_KIND_LABEL } from "@/lib/property";
import { REGION_TYPE_INFO, type RegionInsight, regionInsights, type RegionMarket, type RegionTrade } from "@/lib/region-market";
import { TradeChart } from "./complex-trades";

const KINDS = ["sale", "jeonse", "wolse"] as const;

/**
 * 단지가 없는 유형(단독·토지·상가)의 읍면동 거래: 거래 종류 → 세부 유형(지목·주택 유형·건물 용도) 칩 → 요약 → 점 그래프 → 거래 목록.
 * 면적이 제각각이라 매매는 단위가격으로 그린다.
 */
export function RegionTrades({
  data,
  unit,
  kind: mapKind,
  limit = 12,
  years = 3,
  capped = false,
  insights = false,
}: {
  data: RegionMarket;
  unit: AreaUnit;
  kind: DealKind;
  limit?: number;
  /** 받아 온 거래 기간(요약 라벨) */
  years?: number;
  /** 최근 거래 일부만 받았으면 안내 */
  capped?: boolean;
  /** 맨 위에 '눈여겨볼 점'(상세 페이지는 따로 그린다) */
  insights?: boolean;
}) {
  const info = REGION_TYPE_INFO[data.type];
  const live = data.trades.filter((t) => !t.is_canceled);
  const kinds = KINDS.filter((k) => live.some((t) => t.deal_kind === k));
  const [pickKind, setPickKind] = useState<(typeof KINDS)[number] | null>(null);
  const kind = pickKind ?? (kinds.includes(mapKind) ? mapKind : (kinds[0] ?? "sale"));
  const ofKind = data.trades.filter((t) => t.deal_kind === kind);
  const cats = [...ofKind.reduce((m, t) => m.set(t.category ?? "미상", (m.get(t.category ?? "미상") ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const [pickCat, setPickCat] = useState<string>("all");
  const cat = cats.some(([c]) => c === pickCat) ? pickCat : "all";
  const shown = ofKind.filter((t) => cat === "all" || (t.category ?? "미상") === cat);
  const [more, setMore] = useState(false);
  if (!data.trades.length) return <p className="mt-3 text-sm text-muted">최근 {years}년 거래가 없습니다.</p>;

  const valid = shown.filter((t) => !t.is_canceled);
  const med = median(valid.map((t) => t.price));
  const medUnit = median(valid.map((t) => perUnitArea(t.price, t.area_m2, unit)).filter((v): v is number => v !== null));
  const medRent = kind === "wolse" ? median(valid.map((t) => t.monthly_rent).filter((v): v is number => v !== null)) : null;
  const unitOf = (t: Pick<RegionTrade, "price" | "area_m2">) => perUnitArea(t.price, t.area_m2, unit);

  return (
    <div className="mt-3">
      {insights ? <RegionInsights items={regionInsights(data, unit)} compact /> : null}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {kinds.length > 1
          ? kinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setPickKind(k);
                  setPickCat("all");
                }}
                className={clsx("hit rounded-full px-3 py-1 text-sm", kind === k ? "bg-text font-semibold text-surface" : "bg-surface-2 text-muted")}
              >
                {DEAL_KIND_LABEL[k]}
                <span className="ml-1 tabular opacity-70">{data.trades.filter((t) => t.deal_kind === k).length}</span>
              </button>
            ))
          : null}
      </div>
      {cats.length > 1 ? (
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2" aria-label={info.category}>
          {([["all", ofKind.length], ...cats.slice(0, 10)] as [string, number][]).map(([c, n]) => (
            <button
              key={c}
              type="button"
              onClick={() => setPickCat(c)}
              className={clsx("hit shrink-0 rounded-full border px-3.5 py-1.5 text-sm", cat === c ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted")}
            >
              {c === "all" ? "전체" : c}
              <span className="ml-1 tabular opacity-70">{n}</span>
            </button>
          ))}
        </div>
      ) : null}
      <dl className="mb-2 grid grid-cols-3 gap-2 rounded-xl bg-surface-2/60 p-3 text-center">
        <div>
          <dt className="text-xs text-muted">
            {DEAL_KIND_LABEL[kind]} {capped ? "최근" : `${years}년`}
          </dt>
          <dd className="tabular font-semibold">{valid.length.toLocaleString()}건</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{kind === "wolse" ? "보증금 중위" : "거래가 중위"}</dt>
          <dd className="tabular font-semibold">{formatManwon(med, { short: true })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{kind === "wolse" ? "월세 중위" : `${info.area} ${unitPriceLabel(unit)}`}</dt>
          <dd className="tabular font-semibold">{kind === "wolse" ? (medRent !== null ? `${Math.round(medRent)}만` : "-") : formatManwon(medUnit, { short: true })}</dd>
        </div>
      </dl>
      {kind === "sale" && data.stats.change1y !== null && cat === "all" ? (
        <p className="mb-1 text-xs text-muted">
          {info.area} {unitPriceLabel(unit)} 1년 변화{" "}
          <b className={data.stats.change1y >= 0 ? "text-up" : "text-down"}>{formatPct(data.stats.change1y, 1)}</b>
          <span> (최근 6개월 vs 1년 전, 동네 전체)</span>
        </p>
      ) : null}
      {/* 상세 페이지처럼 넓은 곳에서 그래프가 화면 폭만큼 커지지 않게 */}
      <div className="max-w-lg">
        {kind === "sale" ? <TradeChart trades={shown} y={unitOf} label={`${info.area} ${unitPriceLabel(unit)} 가격`} /> : <TradeChart trades={shown} />}
      </div>
      <ul className="mt-1 divide-y divide-border text-sm">
        {(more ? shown : shown.slice(0, limit)).map((t) => (
          <li key={t.id} className={clsx("flex justify-between gap-2 py-2 tabular", t.is_canceled && "text-muted line-through")}>
            <span className="min-w-0">
              <span className="block truncate">
                {t.category ? <span className="font-medium">{t.category}</span> : null}
                {t.jibun ? <span className="text-muted"> · {t.jibun}</span> : null}
                {t.land_use ? <span className="text-muted"> · {t.land_use}</span> : null}
              </span>
              <span className="block truncate text-xs text-muted">
                {formatDate(t.deal_date)}
                {t.area_m2 ? ` · ${info.area} ${formatArea(t.area_m2, unit)}` : ""}
                {t.land_area_m2 ? ` · 대지 ${formatArea(t.land_area_m2, unit)}` : ""}
                {t.build_year ? ` · ${t.build_year}년` : ""}
                {t.floor ? ` · ${t.floor}층` : ""}
                {t.is_direct ? " · 직거래" : ""}
              </span>
            </span>
            <span className="shrink-0 text-right font-medium">
              {formatManwon(t.price)}
              {t.monthly_rent ? `/${t.monthly_rent}` : ""}
              {t.deal_kind === "sale" && unitOf(t) !== null ? (
                <span className="block text-xs font-normal text-muted">
                  {unitPriceLabel(unit)} {formatManwon(unitOf(t), { short: true })}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {capped ? <p className="mt-1 text-xs text-muted">최근 거래 {data.trades.length.toLocaleString()}건까지만 표시합니다(요약 표는 전체 기준).</p> : null}
      {!more && shown.length > limit ? (
        <button type="button" onClick={() => setMore(true)} className="mt-1 w-full rounded-md py-2.5 text-sm text-accent hover:bg-surface-2">
          거래 {shown.length - limit}건 더 보기
        </button>
      ) : null}
    </div>
  );
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const TONE: Record<RegionInsight["tone"], string> = {
  warn: "border-warn/40 bg-warn/10",
  info: "border-border bg-surface-2/60",
  good: "border-ok/40 bg-ok/10",
};

/** 유형별 '눈여겨볼 점'(지분거래·1층 프리미엄·전환율 등) */
export function RegionInsights({ items, compact = false }: { items: RegionInsight[]; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className={clsx("space-y-1.5", compact ? "mb-3" : "")}>
      {items.map((x) => (
        <li key={x.title} className={clsx("rounded-lg border px-3 py-2", TONE[x.tone])}>
          <b className={clsx("block text-sm", x.tone === "warn" && "text-warn")}>
            {x.tone === "warn" ? "⚠ " : ""}
            {x.title}
          </b>
          <span className={clsx("block text-xs leading-relaxed text-muted", compact && "line-clamp-3")}>{x.text}</span>
        </li>
      ))}
    </ul>
  );
}
