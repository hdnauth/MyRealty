"""알림 규칙 평가 → notifications. 모든 알림은 dedupe_key 로 멱등하게 생성된다."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from ..db import jsonb

log = logging.getLogger(__name__)

COMPLEX_TYPES = ("apt", "officetel", "rowhouse")


def fmt_manwon(v: int | float | None) -> str:
    if v is None:
        return "-"
    v = int(round(v))
    eok, man = divmod(v, 10000)
    if eok and man:
        return f"{eok}억 {man:,}만"
    return f"{eok}억" if eok else f"{man:,}만"


def notify(conn, *, user_id, item_id, kind: str, title: str, body: str | None, url: str | None,
           dedupe_key: str, priority: int = 1, payload: dict | None = None) -> bool:
    res = conn.execute(
        """insert into notifications (user_id, watch_item_id, kind, title, body, url, payload, priority, dedupe_key)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict (user_id, dedupe_key) do nothing""",
        (user_id, item_id, kind, title, body, url, jsonb(payload or {}), priority, dedupe_key),
    )
    return res.rowcount > 0


def last_run(conn, job: str = "alerts") -> datetime | None:
    row = conn.execute(
        "select max(started_at) as t from job_runs where job = %s and status = 'ok'", (job,)
    ).fetchone()
    return row["t"]


ITEM_TX_SQL = """
select t.* from transactions t
where t.complex_id = %(complex_id)s
  and (%(area)s::numeric is null or abs(t.area_m2 - %(area)s::numeric) <= 3)
"""


def rule_trades(conn, item: dict, since: datetime) -> int:
    """신규 거래 요약, 신고가/3년 최저, 해제 거래."""
    if not item["complex_id"]:
        return 0
    n = 0
    p = {"complex_id": item["complex_id"], "area": item["area_m2"]}
    new = conn.execute(
        # 백필로 들어온 과거 거래가 '신규'로 쏟아지지 않도록 최근 60일 계약만 대상
        ITEM_TX_SQL + " and t.collected_at > %(since)s and not t.is_canceled"
        " and t.deal_date >= current_date - 60 order by t.deal_date",
        {**p, "since": since},
    ).fetchall()
    url = f"/items/{item['id']}?tab=price"
    if new:
        sales = [t for t in new if t["deal_kind"] == "sale"]
        rents = [t for t in new if t["deal_kind"] != "sale"]
        parts = []
        if sales:
            lo, hi = min(t["price"] for t in sales), max(t["price"] for t in sales)
            parts.append(f"매매 {len(sales)}건 {fmt_manwon(lo)}" + (f"~{fmt_manwon(hi)}" if hi != lo else ""))
        if rents:
            parts.append(f"전월세 {len(rents)}건")
        n += notify(conn, user_id=item["user_id"], item_id=item["id"], kind="new_trade",
                    title=f"{item['label']} 신규 실거래 {len(new)}건", body=" · ".join(parts), url=url,
                    dedupe_key=f"new_trade:{item['id']}:{date.today()}", payload={"tx_ids": [t["id"] for t in new]})
        for t in sales:
            prior = conn.execute(
                ITEM_TX_SQL + """ and t.deal_kind = 'sale' and not t.is_canceled and t.id <> %(id)s
                  and t.deal_date <= %(deal_date)s""",
                {**p, "id": t["id"], "deal_date": t["deal_date"]},
            ).fetchall()
            if len(prior) < 3:
                continue
            hi = max(x["price"] for x in prior)
            recent = [x["price"] for x in prior if x["deal_date"] >= t["deal_date"] - timedelta(days=365 * 3)]
            if t["price"] > hi:
                n += notify(conn, user_id=item["user_id"], item_id=item["id"], kind="record_high", priority=2,
                            title=f"{item['label']} 신고가 {fmt_manwon(t['price'])}",
                            body=f"직전 최고 {fmt_manwon(hi)} 대비 +{(t['price'] / hi - 1) * 100:.1f}% · {t['deal_date']} {t['floor'] or '-'}층",
                            url=url, dedupe_key=f"record_high:{t['id']}", payload={"tx_id": t["id"], "prev_high": hi})
            elif len(recent) >= 5 and t["price"] < min(recent):
                n += notify(conn, user_id=item["user_id"], item_id=item["id"], kind="record_low",
                            title=f"{item['label']} 3년 내 최저가 {fmt_manwon(t['price'])}",
                            body=f"최근 3년 최저 {fmt_manwon(min(recent))} 하회 · {t['deal_date']}",
                            url=url, dedupe_key=f"record_low:{t['id']}", payload={"tx_id": t["id"]})
    canceled = conn.execute(
        # 백필로 들어온 오래된 해제 거래는 제외(최근 180일 계약 + 최근 60일 해제)
        ITEM_TX_SQL + """ and t.is_canceled and t.updated_at > %(since)s and t.deal_date >= current_date - 180
          and coalesce(t.canceled_at, current_date) >= current_date - 60""", {**p, "since": since}
    ).fetchall()
    for t in canceled:
        n += notify(conn, user_id=item["user_id"], item_id=item["id"], kind="canceled",
                    title=f"{item['label']} 거래 해제 {fmt_manwon(t['price'])}",
                    body=f"{t['deal_date']} 계약 매매가 해제되었습니다(해제일 {t['canceled_at'] or '-'}).",
                    url=url, dedupe_key=f"canceled:{t['id']}")
    return n


def rule_news(conn, since: datetime, threshold: float = 0.7) -> int:
    rows = conn.execute(
        """select l.id, l.relevance, l.impact, l.category, l.ai_summary, a.title, a.url, w.id as item_id, w.user_id, w.label
           from article_links l join articles a on a.id = l.article_id join watch_items w on w.id = l.watch_item_id
           where l.status = 'classified' and l.classified_at > %s and l.relevance >= %s""",
        (since, threshold),
    ).fetchall()
    n = 0
    for r in rows:
        strong = r["relevance"] >= 0.9 and abs(r["impact"] or 0) >= 2
        tone = {2: "호재", 1: "호재", -1: "악재", -2: "악재"}.get(r["impact"] or 0, "")
        n += notify(conn, user_id=r["user_id"], item_id=r["item_id"], kind="news", priority=2 if strong else 1,
                    title=f"[{r['category']}{'·' + tone if tone else ''}] {r['title']}"[:120],
                    body=r["ai_summary"], url=r["url"], dedupe_key=f"news:{r['id']}",
                    payload={"relevance": r["relevance"], "impact": r["impact"], "item_label": r["label"]})
    return n


def rule_subscriptions(conn, since: datetime, radius_m: int = 5000) -> int:
    rows = conn.execute(
        """select distinct on (e.id, w.user_id) e.id, e.title, e.starts_on, e.ends_on, e.payload, e.source_url,
             w.id as item_id, w.user_id, w.label,
             ST_Distance(e.geom::geography, w.geom::geography)::int as dist
           from events e join watch_items w on w.geom is not null and e.geom is not null
             and ST_DWithin(e.geom::geography, w.geom::geography, %s)
           where e.kind = 'subscription' and e.created_at > %s
           order by e.id, w.user_id, dist""",
        (radius_m, since),
    ).fetchall()
    n = 0
    for r in rows:
        hh = (r["payload"] or {}).get("households")
        n += notify(conn, user_id=r["user_id"], item_id=r["item_id"], kind="subscription",
                    title=f"주변 청약: {r['title']}",
                    body=f"{r['label']}에서 {r['dist'] / 1000:.1f}km · 접수 {r['starts_on']}~{r['ends_on'] or ''}"
                         + (f" · {hh}세대" if hh else ""),
                    url=r["source_url"] or "/calendar", dedupe_key=f"sub:{r['id']}")
    return n


def rule_maturities(conn, today: date | None = None) -> int:
    today = today or date.today()
    n = 0
    items = conn.execute("select id, user_id, label, lease, loans from watch_items").fetchall()
    for it in items:
        dates = []
        lease = it["lease"] or {}
        if lease.get("end_date"):
            dates.append(("lease", "임대차 계약 만기" if lease.get("role") != "tenant" else "내 전월세 계약 만기", lease["end_date"]))
        for loan in it["loans"] or []:
            if loan.get("maturity"):
                dates.append(("loan", f"{loan.get('name') or '대출'} 만기", loan["maturity"]))
        for kind, label, d in dates:
            try:
                due = date.fromisoformat(str(d)[:10])
            except ValueError:
                continue
            left = (due - today).days
            bucket = next((b for b in (7, 30, 90) if 0 <= left <= b), None)
            if bucket is None:
                continue
            n += notify(conn, user_id=it["user_id"], item_id=it["id"], kind="lease_expiry", priority=2 if bucket == 7 else 1,
                        title=f"{it['label']} {label} D-{left}", body=f"만기일 {due}", url=f"/items/{it['id']}",
                        dedupe_key=f"{kind}:{it['id']}:{due}:{bucket}")
    return n


def rule_calendar(conn, today: date | None = None) -> int:
    """공시가격 발표·세금 납부 등 연례 일정 7일 전 안내(사용자 단위)."""
    today = today or date.today()
    events = conn.execute(
        "select id, title, starts_on, payload from events where kind in ('official_price', 'tax') and starts_on between %s and %s",
        (today, today + timedelta(days=7)),
    ).fetchall()
    users = conn.execute("select distinct user_id from watch_items").fetchall()
    n = 0
    for e in events:
        for u in users:
            n += notify(conn, user_id=u["user_id"], item_id=None, kind="calendar", priority=0,
                        title=f"{e['title']} D-{(e['starts_on'] - today).days}", body=(e["payload"] or {}).get("note"),
                        url="/calendar", dedupe_key=f"event:{e['id']}")
    return n


def detect_alerts(conn, since: datetime | None = None) -> dict:
    since = since or last_run(conn) or (datetime.now().astimezone() - timedelta(days=1))
    stats = {"since": since.isoformat(), "trades": 0}
    items = conn.execute(
        f"select * from watch_items where property_type in {COMPLEX_TYPES}"
    ).fetchall()
    for it in items:
        stats["trades"] += rule_trades(conn, it, since)
    stats["news"] = rule_news(conn, since)
    stats["subscriptions"] = rule_subscriptions(conn, since)
    stats["maturities"] = rule_maturities(conn)
    stats["calendar"] = rule_calendar(conn)
    conn.commit()
    return stats
