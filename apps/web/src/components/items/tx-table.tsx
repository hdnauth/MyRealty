import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatDate, formatManwon } from "@/lib/format";
import { DEAL_KIND_LABEL } from "@/lib/property";
import type { TxPoint } from "@/lib/queries/items";

export function TxTable({
  rows,
  showName = false,
  limit = 30,
  extra,
  moreHref,
}: {
  rows: (TxPoint & { dist_m?: number })[];
  showName?: boolean;
  limit?: number;
  extra?: "dist";
  moreHref?: string;
}) {
  if (!rows.length) return <p className="px-4 pb-4 text-sm text-muted">거래가 없습니다.</p>;
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full min-w-[520px] whitespace-nowrap text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-4 py-2 font-medium">계약일</th>
            {showName ? <th className="px-2 py-2 font-medium">위치</th> : null}
            <th className="px-2 py-2 font-medium">구분</th>
            <th className="px-2 py-2 text-right font-medium">가격</th>
            <th className="px-2 py-2 text-right font-medium">면적</th>
            <th className="px-2 py-2 text-right font-medium">층</th>
            {extra === "dist" ? <th className="px-4 py-2 text-right font-medium">거리</th> : <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.slice(0, limit).map((r) => (
            <tr key={r.id} className={`border-b border-border/60 last:border-0 ${r.is_canceled ? "text-muted line-through" : ""}`}>
              <td className="px-4 py-2">{formatDate(r.deal_date)}</td>
              {showName ? (
                <td className="max-w-[180px] truncate px-2 py-2">
                  {r.name ?? [r.umd_nm, r.jibun].filter(Boolean).join(" ")}
                  {r.jimok ? <span className="ml-1 text-xs text-muted">{r.jimok}</span> : null}
                </td>
              ) : null}
              <td className="px-2 py-2">{DEAL_KIND_LABEL[r.deal_kind]}</td>
              <td className="px-2 py-2 text-right font-medium">
                {formatManwon(r.price)}
                {r.monthly_rent ? <span className="text-muted"> / {r.monthly_rent}</span> : null}
              </td>
              <td className="px-2 py-2 text-right">{r.area_m2 ? `${Number(r.area_m2).toFixed(1)}㎡` : "-"}</td>
              <td className="px-2 py-2 text-right">{r.floor ?? "-"}</td>
              <td className="px-4 py-2 text-right">
                {extra === "dist" && r.dist_m !== undefined ? `${r.dist_m.toLocaleString()}m` : null}
                {r.is_canceled ? <Badge tone="warn">해제</Badge> : r.is_direct ? <Badge>직거래</Badge> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && moreHref ? (
        <Link href={moreHref} scroll={false} className="block px-4 pt-3 text-center text-sm font-medium text-accent">
          전체 {rows.length.toLocaleString()}건 보기
        </Link>
      ) : null}
    </div>
  );
}
