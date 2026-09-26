import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { NotificationRow } from "@/components/feed/notification-row";
import { ItemCard } from "@/components/items/item-card";
import { Card, CardHeader, EmptyState, LinkButton, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatManwon } from "@/lib/format";
import { calendarEntries, listNotifications } from "@/lib/queries/feed";
import { listItems } from "@/lib/queries/items";

function isoDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default async function HomePage() {
  const user = await requireUser();
  const [items, notes, upcoming] = await Promise.all([
    listItems(user.id),
    listNotifications(user.id, { limit: 8 }),
    calendarEntries(user.id, isoDay(0), isoDay(45)),
  ]);

  const owned = items.filter((i) => i.group_tag === "owned");
  const value = owned.reduce((a, i) => a + (i.estimate ?? i.last_trade_price ?? i.purchase_price ?? 0), 0);
  const cost = owned.reduce((a, i) => a + (i.purchase_price ?? 0), 0);
  const debt = owned.reduce((a, i) => a + i.loans.reduce((s, l) => s + (l.amount || 0), 0) + (i.lease && i.lease.role !== "tenant" ? i.lease.deposit : 0), 0);
  const unread = notes.filter((n) => !n.read_at);
  const highs = unread.filter((n) => n.kind === "record_high").length;
  const news = unread.filter((n) => n.kind === "news").length;

  if (!items.length) {
    return (
      <Card>
        <EmptyState
          title="환영합니다!"
          desc="보유하거나 관심 있는 부동산을 등록하면 실거래·주변 시세·뉴스·정책·일정을 모아 알려드립니다."
          action={<LinkButton href="/items/new">첫 물건 등록하기</LinkButton>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-xs text-muted">{formatDate(new Date(), "long")} 요약</p>
        <p className="mt-1 text-[15px] leading-relaxed">
          {unread.length ? (
            <>
              새 소식 <b>{unread.length}건</b>
              {highs ? <> · 신고가 <b className="text-up">{highs}건</b></> : null}
              {news ? <> · 관련 뉴스 <b>{news}건</b></> : null}
              {upcoming.length ? <> · 45일 내 일정 <b>{upcoming.length}건</b></> : null}
            </>
          ) : (
            "새로운 소식이 없습니다."
          )}
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {owned.length ? (
            <Link href="/portfolio" className="card block p-4 hover:border-accent/40">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="보유 자산 시세" value={formatManwon(value, { short: true })} sub={<span className="text-muted">{owned.length}건</span>} />
                <Stat
                  label="평가 손익"
                  value={cost ? formatManwon(value - cost, { short: true }) : "-"}
                  sub={cost ? <span className={value >= cost ? "text-up" : "text-down"}>{(((value - cost) / cost) * 100).toFixed(1)}%</span> : null}
                />
                <Stat label="순자산" value={formatManwon(value - debt, { short: true })} sub={<span className="text-muted">부채 {formatManwon(debt, { short: true })}</span>} />
              </div>
            </Link>
          ) : null}

          <Card className="overflow-hidden">
            <CardHeader title="최근 소식" action={<Link href="/notifications" className="flex items-center text-accent">전체<ChevronRight size={16} /></Link>} />
            {notes.length ? (
              <div className="divide-y divide-border">
                {notes.map((n) => (
                  <NotificationRow key={n.id} n={n} />
                ))}
              </div>
            ) : (
              <p className="px-4 pb-4 text-sm text-muted">아직 소식이 없습니다. 매일 아침 수집 후 표시됩니다.</p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="내 물건" action={<Link href="/items/new" className="flex items-center text-accent"><Plus size={16} />등록</Link>} />
            <div className="space-y-2 px-3 pb-3">
              {items.slice(0, 6).map((i) => (
                <ItemCard key={i.id} item={i} />
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="다가오는 일정" action={<Link href="/calendar" className="flex items-center text-accent">캘린더<ChevronRight size={16} /></Link>} />
            {upcoming.length ? (
              <ul className="divide-y divide-border px-4 pb-2 text-sm">
                {upcoming.slice(0, 6).map((e, i) => (
                  <li key={i} className="flex gap-3 py-2">
                    <span className="tabular w-12 shrink-0 text-muted">{e.date.slice(5).replace("-", ".")}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{e.title}</span>
                      {e.sub ? <span className="text-xs text-muted">{e.sub}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-sm text-muted">45일 내 일정이 없습니다.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
