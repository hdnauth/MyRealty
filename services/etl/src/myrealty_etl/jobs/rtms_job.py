"""실거래 수집 잡: 최근 N개월 재수집(신고 지연·해제 반영) + 과거 백필."""

from __future__ import annotations

import logging
from datetime import date

from dateutil.relativedelta import relativedelta

from ..collectors import rtms
from ..http import QuotaExceeded
from ..transforms.complexes import ComplexMatcher

log = logging.getLogger(__name__)


def month_list(end: date, months: int) -> list[str]:
    """end 가 속한 달부터 과거로 months 개의 YYYYMM."""
    first = end.replace(day=1)
    return [(first - relativedelta(months=i)).strftime("%Y%m") for i in range(months)]


def upsert_regions(conn, rows: list[dict]) -> None:
    seen = set()
    for r in rows:
        if r.get("lawd_cd") and r.get("umd_nm") and r["lawd_cd"] not in seen:
            seen.add(r["lawd_cd"])
            conn.execute(
                """insert into regions (lawd_cd, emd, level) values (%s, %s, 3)
                   on conflict (lawd_cd) do update set emd = coalesce(regions.emd, excluded.emd)""",
                (r["lawd_cd"], r["umd_nm"]),
            )
    conn.commit()


def collect_month(conn, sgg_cd: str, ym: str, services: list[rtms.Service] | None = None) -> dict:
    stats = {"inserted": 0, "updated": 0, "fetched": 0}
    matcher = ComplexMatcher(conn)
    for svc in services or rtms.SERVICES:
        rows = rtms.fetch(svc, sgg_cd, ym, conn=conn)
        stats["fetched"] += len(rows)
        upsert_regions(conn, rows)
        matcher.assign(rows)
        s = rtms.upsert(conn, rows)
        stats["inserted"] += s["inserted"]
        stats["updated"] += s["updated"]
    return stats


def targets(conn) -> list[dict]:
    return conn.execute("select * from collect_targets where enabled order by created_at").fetchall()


def collect_recent(conn, months: int = 3, today: date | None = None) -> dict:
    from ..config import settings

    if not settings.data_go_kr_key:
        return {"skipped": "DATA_GO_KR_KEY 미설정"}
    today = today or date.today()
    total = {"inserted": 0, "updated": 0, "fetched": 0, "targets": 0, "quota_stop": False}
    try:
        for t in targets(conn):
            total["targets"] += 1
            for ym in month_list(today, months):
                s = collect_month(conn, t["sgg_cd"], ym)
                for k in ("inserted", "updated", "fetched"):
                    total[k] += s[k]
                log.info("%s %s: %s", t["sgg_cd"], ym, s)
    except QuotaExceeded as e:
        log.warning("%s — 남은 수집은 다음 실행으로 이월", e)
        total["quota_stop"] = True
    return total


def backfill(conn, max_months_per_run: int = 6, today: date | None = None) -> dict:
    """각 대상의 backfilled_to 이전 달을 하나씩 거슬러 올라가며 수집한다."""
    from ..config import settings

    if not settings.data_go_kr_key:
        return {"skipped": "DATA_GO_KR_KEY 미설정"}
    today = today or date.today()
    done = {"months": 0, "quota_stop": False}
    try:
        for t in targets(conn):
            oldest = today.replace(day=1) - relativedelta(months=t["backfill_months"])
            cursor = t["backfilled_to"] or (today.replace(day=1) - relativedelta(months=3))
            for _ in range(max_months_per_run):
                month = cursor.replace(day=1) - relativedelta(months=1)
                if month < oldest:
                    break
                collect_month(conn, t["sgg_cd"], month.strftime("%Y%m"))
                conn.execute("update collect_targets set backfilled_to = %s where sgg_cd = %s", (month, t["sgg_cd"]))
                conn.commit()
                cursor = month
                done["months"] += 1
    except QuotaExceeded as e:
        log.warning("%s — 백필 중단", e)
        done["quota_stop"] = True
    return done
