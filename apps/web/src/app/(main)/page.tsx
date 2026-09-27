import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { NotificationRow } from "@/components/feed/notification-row";
import { ItemCard } from "@/components/items/item-card";
import { Card, CardHeader, Change, EmptyState, LinkButton, Stat } from "@/components/ui";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { formatDate, formatManwon } from "@/lib/format";
import { calendarEntries, listNotifications } from "@/lib/queries/feed";
import { listItems } from "@/lib/queries/items";
import { getAreaUnit } from "@/lib/area-unit";
import { sql } from "@/lib/db";
import { insightBalance, marketInsights } from "@/lib/insights";
import { insightInputs } from "@/lib/queries/indicators";

function isoDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default async function HomePage() {
  const uid = await sessionUserId();
  const [, items, notes, upcoming, unit] = await Promise.all([
    requireUser(),
    listItems(uid),
    listNotifications(uid, { limit: 8 }),
    calendarEntries(uid, isoDay(0), isoDay(45)),
    getAreaUnit(),
  ]);

  const owned = items.filter((i) => i.group_tag === "owned");
  // 대표 지역: 보유 → 첫 관심 부동산 순
  const mainSgg = (owned[0] ?? items[0])?.sgg_cd ?? null;
  const [inputs, [monthAgo], newTrades] = await Promise.all([
    insightInputs(mainSgg),
    // 보유 부동산 추정 시세 합계: 30일 전 스냅샷
    sql<{ total: number | null }[]>`
      select sum(v.estimate)::float8 as total from watch_items w
      join lateral (select estimate from valuations where watch_item_id = w.id and as_of <= current_date - 30 order by as_of desc limit 1) v on true
      where w.user_id = ${uid} and w.group_tag = 'owned'`,
    // 지난 7일 새로 신고된 내 단지 거래
    sql<{ item_id: string; label: string; deal_kind: string; price: number; deal_date: string; floor: number | null; area_m2: number | null }[]>`
      select w.id as item_id, w.label, t.deal_kind, t.price, t.deal_date::text, t.floor, t.area_m2::float8 as area_m2
      from watch_items w join transactions t on t.complex_id = w.complex_id and not t.is_canceled
      where w.user_id = ${uid} and w.complex_id is not null and t.collected_at >= now() - interval '7 days'
        and (w.area_m2 is null or abs(t.area_m2 - w.area_m2) <= 3)
      order by t.deal_date desc limit 5`,
  ]);
  const insights = marketInsights(inputs);
  const balance = insightBalance(insights);
  const regionName = mainSgg ? (owned[0] ?? items[0]).road_address?.split(" ").slice(0, 2).join(" ") ?? null : null;
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
          action={<LinkButton href="/items/new">관심 부동산 등록하기</LinkButton>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-xs text-muted">{formatDate(new Date(), "long")} 요약</p>
        <ul className="mt-2 space-y-2 text-[15px] leading-relaxed">
          {owned.length && value ? (
            <li>
              보유 자산 <b className="tabular">{formatManwon(value, { short: true })}</b>
              {monthAgo?.total && owned.every((i) => i.estimate) ? (
                <>
                  {" "}· 한 달 전보다 <Change value={value / monthAgo.total - 1} /> ({formatManwon(value - monthAgo.total, { short: true })})
                </>
              ) : null}
            </li>
          ) : null}
          {insights.length ? (
            <li>
              <Link href="/indicators" className="hover:text-accent">
                {regionName ?? "관심 지역"} 시장: <b>{balance.verdict}</b>
                <span className="text-muted"> — 상승 요인 {balance.up} · 하락 요인 {balance.down}</span>
                <span className="block text-[13px] text-muted">
                  {insights.filter((x) => x.tone !== "neutral").slice(0, 3).map((x) => x.title).join(" · ")}
                </span>
              </Link>
            </li>
          ) : null}
          <li>
            {unread.length ? (
              <>
                새 소식 <b>{unread.length}건</b>
                {highs ? <> · 신고가 <b className="text-up">{highs}건</b></> : null}
                {news ? <> · 관련 뉴스 <b>{news}건</b></> : null}
                {upcoming.length ? <> · 45일 내 일정 <b>{upcoming.length}건</b></> : null}
              </>
            ) : (
              <span className="text-muted">새로운 소식이 없습니다.</span>
            )}
          </li>
        </ul>
      </Card>

      {newTrades.length ? (
        <Card>
          <CardHeader title="이번 주 새로 신고된 거래" sub="관심 부동산과 같은 단지·평형 · 최근 7일 수집" />
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {newTrades.map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/items/${t.item_id}?tab=price`} className="min-w-0 truncate hover:text-accent">
                  {t.label} <span className="text-muted">· {formatDate(t.deal_date)} · {t.floor ? `${t.floor}층` : ""} {t.deal_kind === "sale" ? "매매" : t.deal_kind === "jeonse" ? "전세" : "월세"}</span>
                </Link>
                <b className="tabular shrink-0">{formatManwon(t.price, { short: true })}</b>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

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
            <CardHeader title="관심 부동산" action={<Link href="/items/new" className="flex items-center text-accent"><Plus size={16} />등록</Link>} />
            <div className="space-y-2 px-3 pb-3">
              {items.slice(0, 6).map((i) => (
                <ItemCard key={i.id} item={i} unit={unit} />
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
