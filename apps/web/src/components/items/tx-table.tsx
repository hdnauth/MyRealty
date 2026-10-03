import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatDate, formatManwon } from "@/lib/format";
import { DEAL_KIND_LABEL } from "@/lib/property";
import { complexHref, mapAtHref, type MyComplexes } from "@/lib/links";
import type { TxPoint } from "@/lib/queries/items";

export function TxTable({
  rows,
  showName = false,
  limit = 30,
  extra,
  moreHref,
  myComplexes = null,
  mapType = null,
  discuss = false,
}: {
  /** 단지 거래 행에 "이 거래 이야기하기"(동네 이야기 글쓰기, 거래 첨부) */
  discuss?: boolean;
  rows: (TxPoint & { dist_m?: number; lng?: number | null; lat?: number | null })[];
  /** 위치 칸 링크: 단지는 내 관심 부동산/단지 상세로, 단지 없는 거래는 지도 위치로 */
  myComplexes?: MyComplexes | null;
  /** 지도 링크의 유형 필터(land·house 등) */
  mapType?: string | null;
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
                  <PlaceLink r={r} myComplexes={myComplexes} mapType={mapType} />
                  {r.jimok ? <span className="ml-1 text-xs text-muted">{r.jimok}</span> : null}
                </td>
              ) : null}
              <td className="px-2 py-2">
                {DEAL_KIND_LABEL[r.deal_kind]}
                {r.contract_type === "renewal" ? <span className="ml-1 text-xs text-muted">갱신</span> : null}
              </td>
              <td className="px-2 py-2 text-right font-medium">
                {formatManwon(r.price)}
                {r.monthly_rent ? <span className="text-muted"> / {r.monthly_rent}</span> : null}
                {r.contract_type === "renewal" && r.prev_deposit ? (
                  <span className="block text-[0.75rem] font-normal text-muted">종전 {formatManwon(r.prev_deposit, { short: true })}</span>
                ) : null}
              </td>
              <td className="px-2 py-2 text-right">{r.area_m2 ? `${Number(r.area_m2).toFixed(1)}㎡` : "-"}</td>
              <td className="px-2 py-2 text-right">{r.floor ?? "-"}</td>
              <td className="px-4 py-2 text-right">
                {extra === "dist" && r.dist_m !== undefined ? `${r.dist_m.toLocaleString()}m` : null}
                <TxBadges r={r} />
                {discuss && r.complex_id && !r.is_canceled ? (
                  <Link href={`/community/new?complex=${r.complex_id}&trade=${r.id}`} title="이 거래 이야기하기" aria-label="이 거래 이야기하기" className="ml-1 inline-flex align-middle text-muted hover:text-accent">
                    <MessageCircle size={14} />
                  </Link>
                ) : null}
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

function PlaceLink({ r, myComplexes, mapType }: { r: TxPoint & { lng?: number | null; lat?: number | null }; myComplexes: MyComplexes | null; mapType: string | null }) {
  const text = r.name ?? [r.umd_nm, r.jibun].filter(Boolean).join(" ");
  const href = r.complex_id ? complexHref(r.complex_id, myComplexes) : r.lng != null && r.lat != null ? mapAtHref(r.lng, r.lat, mapType) : null;
  if (!href) return <>{text}</>;
  return (
    <Link href={href} className="hover:text-accent hover:underline" title={r.complex_id ? "단지 보기" : "지도에서 보기(읍면동 중심 좌표일 수 있음)"}>
      {text}
    </Link>
  );
}

/** 거래 표식: 해제 · 미등기(계약 후 90일이 지나도 소유권 이전 등기가 없는 매매) · 법인 매수 · 직거래 */
function TxBadges({ r }: { r: TxPoint }) {
  if (r.is_canceled) return <Badge tone="warn">해제</Badge>;
  return (
    <span className="inline-flex gap-1">
      {r.unregistered ? <Badge tone="warn" title="계약 후 90일이 지나도 등기되지 않은 거래 — 신고가라면 신뢰도를 낮춰 보세요">미등기</Badge> : null}
      {r.buyer_type === "법인" ? <Badge>법인</Badge> : null}
      {r.is_direct ? <Badge title="중개 없이 직접 거래 — 가족 간 거래 등 시세와 다를 수 있음">직거래</Badge> : null}
    </span>
  );
}
