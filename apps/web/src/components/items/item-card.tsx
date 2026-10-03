import { Building, Building2, Home, Landmark, Store, Trees } from "lucide-react";
import Link from "next/link";
import { MiniTrend } from "@/components/charts/mini-trend";
import { Badge, Change } from "@/components/ui";
import { type AreaUnit, formatArea, formatDate, formatManwon } from "@/lib/format";
import { currentValue, GROUP_TAGS, PROPERTY_TYPES, type PropertyType, VALUE_SOURCE_LABEL } from "@/lib/property";

const ICONS: Record<PropertyType, typeof Home> = {
  apt: Building2,
  officetel: Building,
  rowhouse: Building,
  house: Home,
  land: Landmark,
  forest: Trees,
  commercial: Store,
};

export function TypeIcon({ type, size = 18 }: { type: PropertyType; size?: number }) {
  const I = ICONS[type] ?? Home;
  return <I size={size} />;
}

export function ItemCard({
  item,
  unit = "m2",
  trend,
}: {
  unit?: AreaUnit;
  /** 같은 단지·평형 최근 12개월 월 중위가와 1년 변화(홈) */
  trend?: { points: [string, number][]; change1y: number | null };
  item: {
    id: string;
    label: string;
    property_type: PropertyType;
    group_tag: string;
    road_address: string | null;
    jibun_address: string | null;
    area_m2: number | null;
    land_area_m2: number | null;
    estimate: number | null;
    median6m?: number | null;
    last_trade_price: number | null;
    last_trade_date: string | null;
    purchase_price: number | null;
    unread: number;
  };
}) {
  const { value, source } = currentValue(item);
  const gain = value && item.purchase_price && source !== "purchase" ? value / item.purchase_price - 1 : null;
  return (
    <Link href={`/items/${item.id}`} className="card block p-4 transition-colors hover:border-accent/40">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <TypeIcon type={item.property_type} size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold">{item.label}</span>
            {item.unread > 0 ? <Badge tone="up">{item.unread}</Badge> : null}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {GROUP_TAGS[item.group_tag as keyof typeof GROUP_TAGS] ?? item.group_tag} · {PROPERTY_TYPES[item.property_type]?.label} ·{" "}
            {formatArea(item.area_m2 ?? item.land_area_m2, unit)} · {item.road_address ?? item.jibun_address}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tabular text-[1.0625rem] font-bold">{value ? formatManwon(value, { short: true }) : "-"}</div>
          <div className="text-xs text-muted">
            {source === "last" && item.last_trade_date ? `최근 거래 ${formatDate(item.last_trade_date)}` : source ? VALUE_SOURCE_LABEL[source] : "거래 없음"}
            {gain !== null ? (
              <span className={gain >= 0 ? "ml-1 text-up" : "ml-1 text-down"}>
                {gain >= 0 ? "+" : ""}
                {(gain * 100).toFixed(1)}%
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {/* 같은 단지·평형 최근 12개월 매매 흐름 — 숫자보다 먼저 눈에 들어오게 카드 폭 전체로 */}
      {trend && trend.points.length >= 2 ? (
        <div className="mt-3 flex items-center gap-3 border-t border-border pt-2.5">
          <span className="shrink-0 text-xs text-muted">12개월</span>
          <MiniTrend points={trend.points} width={240} height={28} className="h-7 min-w-0 flex-1" stretch />
          <span className="shrink-0 text-xs">
            {trend.change1y != null ? (
              <>
                <span className="text-muted">1년 </span>
                <Change value={trend.change1y} />
              </>
            ) : (
              <span className="text-muted">{trend.points.length}개월 거래</span>
            )}
          </span>
        </div>
      ) : null}
    </Link>
  );
}
