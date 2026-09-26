"""이벤트 수집: 청약 공고·입주 예정(청약홈), 연례 일정(공시가격 발표 등)."""

from __future__ import annotations

import logging
from datetime import date, timedelta

from ..collectors import applyhome
from ..config import settings
from ..db import jsonb
from ..transforms.geocode import geocode

log = logging.getLogger(__name__)

# 매년 반복되는 일정(날짜는 관례상 시기이며 실제 발표일은 공고로 확인)
ANNUAL = [
    ("official_price", 4, 30, "공동주택 공시가격 결정·공시(예정)", "매년 4월 말 결정·공시, 이의신청 후 6월 말 조정"),
    ("official_price", 5, 31, "개별공시지가·개별주택가격 결정·공시(예정)", "매년 5월 말 시군구 공시"),
    ("tax", 7, 31, "재산세 1기분 납부 마감(주택 1/2, 건축물)", "7월 16~31일"),
    ("tax", 9, 30, "재산세 2기분 납부 마감(주택 1/2, 토지)", "9월 16~30일"),
    ("tax", 12, 15, "종합부동산세 납부 마감", "12월 1~15일"),
]


def upsert_event(conn, ev: dict, geom: tuple[float, float] | None = None) -> None:
    conn.execute(
        """insert into events (source_key, kind, title, starts_on, ends_on, sgg_cd, address, geom, payload, source_url)
           values (%(source_key)s, %(kind)s, %(title)s, %(starts_on)s, %(ends_on)s, %(sgg_cd)s, %(address)s,
             case when %(lng)s::float8 is null then null else ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326) end,
             %(payload)s, %(source_url)s)
           on conflict (source_key) do update set title = excluded.title, starts_on = excluded.starts_on,
             ends_on = excluded.ends_on, payload = excluded.payload, source_url = excluded.source_url,
             geom = coalesce(excluded.geom, events.geom), sgg_cd = coalesce(excluded.sgg_cd, events.sgg_cd)""",
        {**ev, "sgg_cd": ev.get("sgg_cd"), "lng": geom and geom[0], "lat": geom and geom[1],
         "payload": jsonb(ev.get("payload") or {})},
    )


def annual_events(conn, today: date | None = None) -> int:
    today = today or date.today()
    n = 0
    for year in (today.year, today.year + 1):
        for kind, m, d, title, note in ANNUAL:
            upsert_event(conn, {"source_key": f"rule:{kind}:{year}-{m:02d}-{d:02d}", "kind": kind, "title": title,
                                "starts_on": date(year, m, d), "ends_on": None, "address": None,
                                "payload": {"note": note, "rule": True}, "source_url": None})
            n += 1
    conn.commit()
    return n


def target_sidos(conn) -> set[str]:
    """관심 지역의 시도명 앞 2글자(서울·경기 …) — 청약홈 공급지역명과 비교."""
    rows = conn.execute("select name from collect_targets where enabled and name is not null").fetchall()
    return {r["name"].split()[0][:2] for r in rows}


def collect_events(conn, today: date | None = None) -> dict:
    today = today or date.today()
    stats = {"annual": annual_events(conn, today)}
    if not settings.data_go_kr_key:
        stats["applyhome"] = "skipped: DATA_GO_KR_KEY 미설정"
        return stats
    sidos = target_sidos(conn)
    rows = applyhome.fetch(today - timedelta(days=45), conn)
    n = geo = 0
    for row in rows:
        for ev in applyhome.parse(row):
            pt = None
            area = (row.get("SUBSCRPT_AREA_CODE_NM") or "")[:2]
            if ev["address"] and (not sidos or area in sidos):
                pt = geocode(conn, ev["address"])
                geo += 1 if pt else 0
            upsert_event(conn, ev, pt)
            n += 1
    conn.commit()
    stats.update({"applyhome": n, "geocoded": geo})
    return stats
