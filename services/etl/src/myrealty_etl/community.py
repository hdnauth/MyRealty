"""동네 이야기(커뮤니티) 배치: 데이터 시스템 글, 인기글 알림, 고아 이미지 정리.

- 시스템 글: 수집 단지의 신고가 매매, 시군구 청약 공고를 그 단지·시군구 게시판에 "데이터" 글로 올려 대화 소재로 쓴다.
  source_key 로 멱등하게 만든다(재실행 안전).
- 인기글 알림: 구독 게시판(관심 부동산의 단지·시군구 + 직접 구독)에서 지난 하루 반응이 많은 글을 하루 1건 알린다.
"""

from __future__ import annotations

import logging
from datetime import date

from .alerts.rules import fmt_manwon, notify
from .db import jsonb

log = logging.getLogger(__name__)

# 가격대가 다른 평형끼리 섞이지 않게 ±3㎡ 안 거래만 비교(알림 규칙과 같은 기준)
RECORD_HIGH_SQL = """
with fresh as (
  select t.id, t.complex_id, t.area_m2, t.price, t.deal_date, t.floor, c.name, c.sgg_cd
  from transactions t join complexes c on c.id = t.complex_id
  where t.deal_kind = 'sale' and not t.is_canceled and t.complex_id is not null
    and t.collected_at > now() - make_interval(days => %(days)s)
    and t.deal_date >= current_date - 60
)
select f.*, p.prev_high, p.n
from fresh f
join lateral (
  select max(x.price) as prev_high, count(*) as n from transactions x
  where x.complex_id = f.complex_id and x.deal_kind = 'sale' and not x.is_canceled and x.id <> f.id
    and abs(x.area_m2 - f.area_m2) <= 3 and x.deal_date <= f.deal_date
) p on true
where p.n >= 3 and f.price > p.prev_high
order by f.deal_date
"""


def _post(conn, *, source_key: str, sgg: str, complex_id: int | None, title: str, body: str, attachments: list) -> bool:
    res = conn.execute(
        """insert into community_posts (sgg_cd, complex_id, category, kind, title, body, attachments, source_key)
           values (%s, %s, 'data', 'system', %s, %s, %s, %s) on conflict (source_key) do nothing""",
        (sgg, complex_id, title[:80], body, jsonb(attachments), source_key),
    )
    return res.rowcount > 0


def system_posts(conn, days: int = 2) -> dict:
    """신고가·청약 시스템 글. 같은 단지에서 하루 여러 건이면 가장 높은 거래 하나만."""
    highs = conn.execute(RECORD_HIGH_SQL, {"days": days}).fetchall()
    best: dict[tuple, dict] = {}
    for h in highs:
        key = (h["complex_id"], round(float(h["area_m2"])), h["deal_date"])
        if key not in best or h["price"] > best[key]["price"]:
            best[key] = h
    n_high = 0
    for h in best.values():
        area = float(h["area_m2"])
        rise = (h["price"] / h["prev_high"] - 1) * 100
        n_high += _post(
            conn,
            source_key=f"record_high:{h['id']}",
            sgg=h["sgg_cd"],
            complex_id=h["complex_id"],
            title=f"{h['name']} {area:.0f}㎡ 신고가 {fmt_manwon(h['price'])}",
            body=(f"{h['deal_date']} {h['floor'] or '-'}층 매매가 {fmt_manwon(h['price'])}에 신고됐습니다. "
                  f"같은 평형 직전 최고 {fmt_manwon(h['prev_high'])}보다 {rise:.1f}% 높습니다.\n\n"
                  "이 거래를 어떻게 보시나요? 층·향·수리 상태 등 아시는 정보가 있으면 나눠 주세요."),
            attachments=[{"type": "trade", "id": h["id"]}, {"type": "complex", "id": h["complex_id"], "area": round(area, 1)}],
        )
    subs = conn.execute(
        """select e.id, e.title, e.starts_on, e.ends_on, e.payload, e.source_url, coalesce(e.sgg_cd, left(e.lawd_cd, 5)) as sgg
           from events e
           where e.kind = 'subscription' and e.created_at > now() - make_interval(days => %(days)s)
             and coalesce(e.sgg_cd, left(e.lawd_cd, 5)) is not null
             and (e.ends_on is null or e.ends_on >= current_date)""",
        {"days": days},
    ).fetchall()
    n_sub = 0
    for e in subs:
        p = e["payload"] or {}
        hh = p.get("households")
        lines = [f"청약 접수 {e['starts_on'] or '-'} ~ {e['ends_on'] or ''}"]
        if hh:
            lines.append(f"공급 {hh}세대")
        if p.get("price_per_pyeong"):
            lines.append(f"분양가 평당 {fmt_manwon(p['price_per_pyeong'])}")
        if e["source_url"]:
            lines.append(e["source_url"])
        lines.append("\n분양가가 주변 시세와 비교해 어떤지, 청약하실 계획인지 이야기 나눠 보세요.")
        n_sub += _post(conn, source_key=f"subscription:{e['id']}", sgg=e["sgg"], complex_id=None,
                       title=f"청약 소식: {e['title']}", body="\n".join(lines), attachments=[])
    conn.commit()
    return {"record_highs": n_high, "subscriptions": n_sub}


def hot_post_alerts(conn, min_score: int = 5) -> int:
    """구독 게시판에서 지난 하루 인기글(좋아요×2 + 댓글×3 ≥ min_score)을 사용자당 하루 1건 알린다(작성자 본인 제외)."""
    rows = conn.execute(
        """with subs as (
             select distinct w.user_id, 'sgg' as scope, w.sgg_cd as scope_id from watch_items w where w.sgg_cd is not null
             union select distinct w.user_id, 'complex', w.complex_id::text from watch_items w where w.complex_id is not null
             union select user_id, scope, scope_id from community_follows
           ), hot as (
             select p.id, p.title, p.sgg_cd, p.complex_id, p.user_id as author, p.like_count, p.comment_count,
                    p.like_count * 2 + p.comment_count * 3 as score
             from community_posts p
             where p.status = 'visible' and p.created_at > now() - interval '1 day'
               and p.like_count * 2 + p.comment_count * 3 >= %s
           )
           select distinct on (s.user_id) s.user_id, h.id, h.title, h.like_count, h.comment_count
           from subs s join hot h on (s.scope = 'sgg' and h.sgg_cd = s.scope_id) or (s.scope = 'complex' and h.complex_id::text = s.scope_id)
           join users u on u.id = s.user_id and u.status = 'active'
           where h.author is distinct from s.user_id
           order by s.user_id, h.score desc""",
        (min_score,),
    ).fetchall()
    n = 0
    for r in rows:
        n += notify(conn, user_id=r["user_id"], item_id=None, kind="community_hot", priority=0,
                    title=f"동네 인기글: {r['title']}"[:120], body=f"좋아요 {r['like_count']} · 댓글 {r['comment_count']}",
                    url=f"/community/posts/{r['id']}", dedupe_key=f"hot:{date.today()}")
    conn.commit()
    return n


def cleanup_images(conn) -> int:
    """글에 붙지 않은 채 하루 지난 업로드 사진 삭제"""
    res = conn.execute("delete from community_images where post_id is null and created_at < now() - interval '1 day'")
    conn.commit()
    return res.rowcount


def run_community(conn) -> dict:
    return {**system_posts(conn), "hot_alerts": hot_post_alerts(conn), "images_cleaned": cleanup_images(conn)}
