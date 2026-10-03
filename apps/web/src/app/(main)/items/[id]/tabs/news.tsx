import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { mapAtHref } from "@/lib/links";
import { NotificationRow } from "@/components/feed/notification-row";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { formatDate, formatManwon, formatPct, safeHref } from "@/lib/format";
import { type PresaleModel, presaleVsMarket } from "@/lib/queries/presale";
import { eventsNear, itemArticles, listNotifications, regionWordsOf } from "@/lib/queries/feed";
import type { WatchItem } from "@/lib/queries/items";
import { sql } from "@/lib/db";
import { errorNote } from "@/lib/collect-steps";
import { serverAiEnabled } from "@/lib/ai/client";

const EVENT_LABEL: Record<string, string> = { subscription: "청약", move_in: "입주", development: "개발", regulation: "규제" };

export async function NewsTab({ item }: { item: WatchItem }) {
  const [articles, events, notes, emptyWhy] = await Promise.all([
    itemArticles(item.id, 0.5, 50, regionWordsOf(item.jibun_address ?? item.road_address)),
    item.lng !== null && item.lat !== null ? eventsNear(item.lng, item.lat, 5000) : Promise.resolve([]),
    listNotifications(item.user_id, { itemId: item.id, limit: 20 }),
    newsEmptyReason(item.id),
  ]);
  // 청약 공고 중 주택형별 분양가가 있는 것: 주변 시세와 비교
  const presale = new Map(
    await Promise.all(
      events
        .filter((e) => e.kind === "subscription" && Array.isArray(e.payload?.models) && (e.payload.models as unknown[]).length && e.lng !== null)
        .map(async (e) => [e.id, await presaleVsMarket(e.lng!, e.lat!, e.payload.models as PresaleModel[])] as const),
    ),
  );
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="관련 뉴스"
          sub={`키워드: ${item.keywords.join(", ") || "없음"} · ${serverAiEnabled() ? "AI 관련도 0.5 이상" : "AI 분류 꺼짐 — 구체적인 키워드·본문 언급 순"}`}
        />
        {articles.length ? (
          <ul className="divide-y divide-border">
            {articles.map((a) => (
              <li key={a.link_id}>
                <a href={safeHref(a.url) ?? undefined} target="_blank" rel="noreferrer" className="block px-4 py-3 hover:bg-surface-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    {a.category ? (
                      <Badge tone="accent">{a.category}</Badge>
                    ) : a.query ? (
                      <Badge tone={a.mentioned && a.local ? "accent" : "neutral"}>
                        {a.query}
                        {a.local ? "" : " · 다른 지역일 수 있음"}
                      </Badge>
                    ) : (
                      <Badge>분류 대기</Badge>
                    )}
                    {a.impact ? (
                      <Badge tone={a.impact > 0 ? "up" : "down"}>
                        {a.impact > 0 ? "▲ 호재" : "▼ 악재"}
                        {Math.abs(a.impact) === 2 ? "(강)" : ""}
                      </Badge>
                    ) : null}
                    {a.relevance !== null ? <span>관련도 {Math.round(a.relevance * 100)}</span> : null}
                    <span>· {a.source ?? ""} · {formatDate(a.published_at)}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium leading-snug">
                    {a.title} <ExternalLink size={12} className="inline text-muted" />
                  </p>
                  {a.ai_summary ? <p className="mt-1 text-[13px] text-text/80">🤖 {a.ai_summary}</p> : null}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="관련 뉴스가 없습니다" desc={emptyWhy} />
        )}
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="주변 이벤트" sub="반경 5km · 청약·입주 예정" />
          {events.length ? (
            <ul className="divide-y divide-border px-4 pb-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="accent">{EVENT_LABEL[e.kind] ?? e.kind}</Badge>
                    <span className="text-xs text-muted">
                      {formatDate(e.starts_on)}
                      {e.dist_m !== null ? ` · ${(e.dist_m / 1000).toFixed(1)}km` : ""}
                    </span>
                  </div>
                  <p className="mt-1 font-medium">
                    {e.lng !== null && e.lat !== null ? (
                      <Link href={mapAtHref(e.lng, e.lat, "apt")} className="hover:text-accent hover:underline" title="지도에서 보기">
                        {e.title}
                      </Link>
                    ) : (
                      e.title
                    )}
                    {safeHref(e.source_url) ? (
                      <a href={safeHref(e.source_url)!} target="_blank" rel="noreferrer" className="ml-1 text-xs font-normal text-accent">
                        공고 <ExternalLink size={11} className="inline" />
                      </a>
                    ) : null}
                  </p>
                  {e.payload?.households ? <p className="text-xs text-muted">{String(e.payload.households)}세대</p> : null}
                  {presale.get(e.id)?.length ? (
                    <table className="mt-1.5 w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted">
                          <th className="py-0.5 font-medium">주택형</th>
                          <th className="py-0.5 text-right font-medium">분양가</th>
                          <th className="py-0.5 text-right font-medium">주변 시세 대비</th>
                        </tr>
                      </thead>
                      <tbody className="tabular">
                        {presale.get(e.id)!.map((m) => (
                          <tr key={m.type} className="border-t border-border/60">
                            <td className="py-1">{Math.floor(m.area)}㎡</td>
                            <td className="py-1 text-right">{formatManwon(m.top_price, { short: true })}</td>
                            <td className={`py-1 text-right ${m.gap === null ? "text-muted" : m.gap < 0 ? "text-down" : "text-up"}`} title={m.market ? `주변 ${m.marketN}건 중위 ${formatManwon(m.market, { short: true })}${m.marketNew ? ` · 10년 이내 신축 ${formatManwon(m.marketNew, { short: true })}` : ""}` : "주변 거래 부족"}>
                              {m.gap === null ? "거래 부족" : formatPct(m.gap, 0)}
                              {m.gapNew !== null ? <span className="block text-[10px] text-muted">신축 대비 {formatPct(m.gapNew, 0)}</span> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted">없음</p>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="이 부동산 알림" />
          {notes.length ? (
            <div className="divide-y divide-border">
              {notes.map((n) => (
                <NotificationRow key={n.id} n={n} showItem={false} />
              ))}
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted">없음</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/** 뉴스가 비어 있는 이유: 이 부동산 개별 수집·매일 수집의 마지막 뉴스 단계 결과 */
async function newsEmptyReason(itemId: string): Promise<string> {
  const [r] = await sql<{ step: { status?: string; detail?: Record<string, unknown> } | null; job: { status: string; detail: Record<string, unknown> | null } | null }[]>`
    select
      (select steps->'news' from item_collect_runs where watch_item_id = ${itemId} and steps ? 'news' order by requested_at desc limit 1) as step,
      (select jsonb_build_object('status', status, 'detail', detail) from job_runs where job = 'news' order by started_at desc limit 1) as job`;
  const d = r?.step?.detail ?? r?.job?.detail ?? null;
  const err = r?.step?.status === "error" || r?.job?.status === "error" ? (d?.error as string | undefined) : undefined;
  if (err) return `뉴스를 모으지 못했습니다: ${errorNote(err)}`;
  // 수집 설정 문제(키 없음 등)는 관리 › 시스템에서 다루고, 사용자에게는 준비 중으로 안내한다
  if (typeof d?.skipped === "string") return "관련 뉴스 기능을 준비하고 있습니다. 준비되면 키워드별 기사를 매일 모아 드립니다.";
  if (d) return "최근 90일 동안 키워드에 맞는 기사가 없습니다. 키워드는 수정 화면에서 바꿀 수 있습니다.";
  return "매일 아침 수집 때 키워드별 뉴스를 모으고 AI 가 관련도를 판단합니다.";
}
