import { ExternalLink } from "lucide-react";
import { NotificationRow } from "@/components/feed/notification-row";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { eventsNear, itemArticles, listNotifications } from "@/lib/queries/feed";
import type { WatchItem } from "@/lib/queries/items";

const EVENT_LABEL: Record<string, string> = { subscription: "청약", move_in: "입주", development: "개발", regulation: "규제" };

export async function NewsTab({ item }: { item: WatchItem }) {
  const [articles, events, notes] = await Promise.all([
    itemArticles(item.id),
    item.lng !== null && item.lat !== null ? eventsNear(item.lng, item.lat, 5000) : Promise.resolve([]),
    listNotifications(item.user_id, { itemId: item.id, limit: 20 }),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="관련 뉴스" sub={`키워드: ${item.keywords.join(", ") || "없음"} · AI 관련도 0.5 이상`} />
        {articles.length ? (
          <ul className="divide-y divide-border">
            {articles.map((a) => (
              <li key={a.link_id}>
                <a href={a.url} target="_blank" rel="noreferrer" className="block px-4 py-3 hover:bg-surface-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    {a.category ? <Badge tone="accent">{a.category}</Badge> : <Badge>분류 대기</Badge>}
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
          <EmptyState title="관련 뉴스가 없습니다" desc="네이버 검색 API 키를 설정하면 매일 키워드별 뉴스를 모으고 AI가 관련도를 판단합니다." />
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
                  <p className="mt-1 font-medium">{e.title}</p>
                  {e.payload?.households ? <p className="text-xs text-muted">{String(e.payload.households)}세대</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted">없음</p>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="이 물건 알림" />
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
