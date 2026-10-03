"""실거래 수집 잡: 최근 N개월 재수집(신고 지연·해제 반영) + 과거 백필."""

from __future__ import annotations

import logging
import time
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


def backfill(conn, max_months_per_run: int = 6, today: date | None = None, deadline: float | None = None) -> dict:
    """각 대상의 backfilled_to 이전 달을 하나씩 거슬러 올라가며 수집한다.

    대상들을 한 달씩 번갈아 수집하고, deadline(time.monotonic 기준)이 지나면 다음 달을 시작하지 않고 멈춘다.
    backfilled_to 를 달마다 저장하므로 멈춘 곳부터 다음 실행에서 이어진다(시간에 걸려도 한 지역만 밀리지 않는다)."""
    from ..config import settings

    if not settings.data_go_kr_key:
        return {"skipped": "DATA_GO_KR_KEY 미설정"}
    today = today or date.today()
    done = {"months": 0, "quota_stop": False, "time_stop": False}
    queue = [
        {
            "sgg_cd": t["sgg_cd"],
            # 아직 백필 전이면 rtms 가 맡는 최근 3개월(이번 달 포함)의 가장 오래된 달 다음부터
            "cursor": t["backfilled_to"] or (today.replace(day=1) - relativedelta(months=2)),
            "oldest": today.replace(day=1) - relativedelta(months=t["backfill_months"]),
        }
        for t in targets(conn)
    ]
    try:
        for _ in range(max_months_per_run):
            progressed = False
            for q in queue:
                month = q["cursor"].replace(day=1) - relativedelta(months=1)
                if month < q["oldest"]:
                    continue
                if deadline is not None and time.monotonic() >= deadline:
                    log.info("백필: 시간 예산 소진 — %s개월 수집, 나머지는 다음 실행으로 이월", done["months"])
                    done["time_stop"] = True
                    return done
                s = collect_month(conn, q["sgg_cd"], month.strftime("%Y%m"))
                conn.execute("update collect_targets set backfilled_to = %s where sgg_cd = %s", (month, q["sgg_cd"]))
                conn.commit()
                q["cursor"] = month
                done["months"] += 1
                progressed = True
                log.info("백필 %s %s: %s", q["sgg_cd"], month.strftime("%Y%m"), s)
            if not progressed:
                break
    except QuotaExceeded as e:
        log.warning("%s — 백필 중단", e)
        done["quota_stop"] = True
    return done
