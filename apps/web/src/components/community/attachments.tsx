import { Building2, LineChart, Receipt } from "lucide-react";
import Link from "next/link";
import { Sparkline } from "@/components/charts/series-chart";
import { Badge } from "@/components/ui";
import type { AreaUnit } from "@/lib/format";
import { formatArea, formatDate, formatManwon, formatNumber } from "@/lib/format";
import { type Attachment, loadAttachments } from "@/lib/community/queries";

const DEAL = { sale: "매매", jeonse: "전세", wolse: "월세" } as Record<string, string>;

/** 글에 붙은 데이터 카드(실거래·단지 시세·지표)와 사진 */
export async function AttachmentCards({ attachments, unit }: { attachments: Attachment[]; unit: AreaUnit }) {
  if (!attachments.length) return null;
  const data = await loadAttachments(attachments);
  const images = attachments.filter((a): a is Extract<Attachment, { type: "image" }> => a.type === "image");
  const cards = attachments.filter((a) => a.type !== "image");
  return (
    <div className="space-y-3">
      {images.length ? (
        <div className={images.length === 1 ? "" : "grid grid-cols-2 gap-2"}>
          {images.map((a) => (
            <a key={a.id} href={`/api/community/images/${a.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/community/images/${a.id}`} alt="첨부 사진" loading="lazy" className="max-h-96 w-full object-cover" />
            </a>
          ))}
        </div>
      ) : null}
      {cards.length ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {cards.map((a, i) => {
            if (a.type === "trade") {
              const t = data.trades.get(a.id);
              if (!t) return null;
              return (
                <Link key={i} href={t.complex_id ? `/complexes/${t.complex_id}${t.area_m2 ? `?area=${t.area_m2}` : ""}` : "#"} className="rounded-lg border border-border p-3 hover:border-accent/40">
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <Receipt size={13} /> 실거래 · {formatDate(t.deal_date)}
                    {t.record_high ? <Badge tone="up">신고가</Badge> : null}
                    {t.is_canceled ? <Badge tone="warn">해제</Badge> : null}
                    {t.is_direct ? <Badge>직거래</Badge> : null}
                  </div>
                  <p className="mt-1 truncate text-sm font-medium">{t.complex_name ?? "거래"}</p>
                  <p className="text-xs text-muted">
                    {formatArea(t.area_m2, unit)} · {t.floor ? `${t.floor}층` : "-"} · {DEAL[t.deal_kind] ?? t.deal_kind}
                  </p>
                  <p className="tabular mt-1 text-lg font-bold">
                    {formatManwon(t.price, { short: true })}
                    {t.deal_kind === "wolse" && t.monthly_rent ? <span className="text-sm font-normal text-muted"> / {formatNumber(t.monthly_rent)}</span> : null}
                  </p>
                </Link>
              );
            }
            if (a.type === "complex") {
              const c = data.complexes.get(a.id);
              if (!c) return null;
              return (
                <Link key={i} href={`/complexes/${c.id}${c.area ? `?area=${c.area}` : ""}`} className="rounded-lg border border-border p-3 hover:border-accent/40">
                  <div className="flex items-center gap-1.5 text-xs text-muted"><Building2 size={13} /> 단지 시세</div>
                  <p className="mt-1 truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted">
                    {[c.umd_nm, c.build_year ? `${c.build_year}년` : null, c.households ? `${formatNumber(c.households)}세대` : null, c.area ? formatArea(c.area, unit) : null].filter(Boolean).join(" · ")}
                  </p>
                  <p className="tabular mt-1 text-lg font-bold">
                    {c.median ? formatManwon(c.median, { short: true }) : "-"}
                    <span className="ml-1 text-xs font-normal text-muted">최근 1년 매매 중위 · {c.trades}건</span>
                  </p>
                </Link>
              );
            }
            const s = data.series.get(a.code);
            if (!s) return null;
            const last = s.points.at(-1);
            return (
              <Link key={i} href="/indicators" className="rounded-lg border border-border p-3 hover:border-accent/40">
                <div className="flex items-center gap-1.5 text-xs text-muted"><LineChart size={13} /> 지표</div>
                <p className="mt-1 truncate text-sm font-medium">{s.name}</p>
                <div className="flex items-end justify-between gap-2">
                  <p className="tabular text-lg font-bold">
                    {last ? formatNumber(last[1], Math.abs(last[1]) < 100 ? 1 : 0) : "-"}
                    <span className="ml-1 text-xs font-normal text-muted">{s.unit ?? ""} {last ? `(${last[0].slice(0, 7)})` : ""}</span>
                  </p>
                  <div className="w-24"><Sparkline points={s.points} height={32} /></div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
