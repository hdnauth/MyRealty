import { Building, Building2, Home, Landmark, Store, Trees } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { type AreaUnit, formatArea, formatDate, formatManwon } from "@/lib/format";
import { GROUP_TAGS, PROPERTY_TYPES, type PropertyType } from "@/lib/property";

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
}: {
  unit?: AreaUnit;
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
    last_trade_price: number | null;
    last_trade_date: string | null;
    purchase_price: number | null;
    unread: number;
  };
}) {
  const value = item.estimate ?? item.last_trade_price;
  const gain = value && item.purchase_price ? value / item.purchase_price - 1 : null;
  return (
    <Link href={`/items/${item.id}`} className="card flex items-center gap-3 p-4 transition-colors hover:border-accent/40">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <TypeIcon type={item.property_type} />
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
        <div className="tabular font-semibold">{value ? formatManwon(value, { short: true }) : "-"}</div>
        <div className="text-[11px] text-muted">
          {item.estimate ? "추정" : item.last_trade_date ? `최근 ${formatDate(item.last_trade_date)}` : "거래 없음"}
          {gain !== null ? (
            <span className={gain >= 0 ? "ml-1 text-up" : "ml-1 text-down"}>
              {gain >= 0 ? "+" : ""}
              {(gain * 100).toFixed(1)}%
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
