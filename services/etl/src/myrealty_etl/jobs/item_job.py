"""관심 부동산 개별 수집: 등록 직후(또는 빈 데이터가 있을 때) 그 부동산 하나만 바로 채운다.

매일 파이프라인(daily)은 관심 부동산이 있는 시군구 전체를 돌지만, 여기서는 이 부동산의 유형·시군구·필지·좌표만
대상으로 해 몇 분 안에 끝낸다. 단계마다 item_collect_runs.steps 를 갱신해 화면이 진행 상황을 보여 주고,
끝난 단계부터 새로 그린다. 한 단계가 실패해도 다음 단계를 계속한다.

    uv run myrealty item --item <watch_item uuid> [--run <item_collect_runs.id>]
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date

from dateutil.relativedelta import relativedelta

from ..collectors import rtms
from ..config import settings
from ..db import jsonb
from ..http import QuotaExceeded
from ..transforms.complexes import ComplexMatcher, link_watch_items
from ..transforms.geocode import geocode_pending
from .rtms_job import month_list, upsert_regions

log = logging.getLogger(__name__)

# 화면(apps/web/src/lib/collect.ts)과 같은 키·순서
STEPS: list[tuple[str, str]] = [
    ("trades", "최근 1년 실거래"),
    ("attrs", "건축물대장·토지·공시가격"),
    ("location", "주변 시설·입지 점수"),
    ("valuation", "추정 시세"),
    ("news", "관련 뉴스"),
    ("history", "과거 실거래(3년)"),
]
TX_TYPE = {"apt": "apt", "officetel": "officetel", "rowhouse": "rowhouse", "house": "house", "commercial": "commercial",
           "land": "land", "forest": "land"}
RECENT_MONTHS = 12


def services_for(property_type: str) -> list[rtms.Service]:
    tx = TX_TYPE.get(property_type)
    return [s for s in rtms.SERVICES if s.property_type == tx]


def collect_months(conn, item: dict, months: list[str]) -> dict:
    """이 부동산 유형의 실거래(매매·전월세)를 시군구·월 단위로 받는다. 최근 달부터."""
    if not settings.data_go_kr_key:
        return {"skipped": "DATA_GO_KR_KEY 미설정"}
    stats = {"inserted": 0, "updated": 0, "fetched": 0, "months": 0}
    matcher = ComplexMatcher(conn)
    for ym in months:
        for svc in services_for(item["property_type"]):
            rows = rtms.fetch(svc, item["sgg_cd"], ym, conn=conn)
            stats["fetched"] += len(rows)
            upsert_regions(conn, rows)
            matcher.assign(rows)
            s = rtms.upsert(conn, rows)
            stats["inserted"] += s["inserted"]
            stats["updated"] += s["updated"]
        stats["months"] += 1
    return stats


def place(conn, item: dict) -> dict:
    """새 단지·읍면동 좌표(내 동네부터) → 관심 부동산 ↔ 단지 연결 → 거래 좌표 전파."""
    geo = geocode_pending(conn, limit=200, sgg_cd=item["sgg_cd"], lawd_cd=item["lawd_cd"])
    return {"geocode": geo, "link": link_watch_items(conn)}


def trades_step(conn, item: dict, today: date) -> dict:
    s = collect_months(conn, item, month_list(today, RECENT_MONTHS))
    if "skipped" in s:
        return s
    return {**s, **place(conn, item)}


def history_step(conn, item: dict, today: date) -> dict:
    """최근 1년 이전 ~ 백필 목표(기본 36개월)까지. 끝나면 지수·추정 시세를 다시 계산한다."""
    row = conn.execute("select backfill_months from collect_targets where sgg_cd = %s", (item["sgg_cd"],)).fetchone()
    total = (row and row["backfill_months"]) or 36
    start = today.replace(day=1) - relativedelta(months=RECENT_MONTHS)
    s = collect_months(conn, item, month_list(start, max(0, total - RECENT_MONTHS)))
    if "skipped" in s:
        return s
    s.update(place(conn, item))
    if TX_TYPE.get(item["property_type"]) == "apt":
        from ..analytics.indicators import compute_region

        try:
            s["index"] = compute_region(conn, item["sgg_cd"], today)
        except Exception as e:  # 지수는 보조 정보
            log.warning("지수 계산 실패 %s: %s", item["sgg_cd"], e)
    from ..analytics.avm import compute_valuations

    s["valuation"] = compute_valuations(conn, today, item_id=item["id"])
    return s


def attrs_step(conn, item: dict, today: date) -> dict:
    from .attrs_job import refresh_attrs

    s = refresh_attrs(conn, item_id=item["id"])
    # 키가 없어 아무것도 못 받았으면 '없음'이 아니라 '건너뜀'으로(화면이 사유를 보여 준다)
    if s.get("skipped") and not (s["buildings"] or s["parcels"] or s["prices"] or s["errors"]):
        return {"skipped": " · ".join(s["skipped"]) + " 미설정"}
    return s


def location_step(conn, item: dict, today: date) -> dict:
    from .pois_job import collect_pois

    # 좌표는 trades 단계에서 단지와 연결되며 생길 수 있다
    if not conn.execute("select 1 from watch_items where id = %s and geom is not null", (item["id"],)).fetchone():
        return {"skipped": "좌표를 찾지 못했습니다(주소 지오코딩 키 확인)"}
    return collect_pois(conn, item_id=item["id"])


def valuation_step(conn, item: dict, today: date) -> dict:
    from ..analytics.avm import compute_valuations

    return compute_valuations(conn, today, item_id=item["id"])


def news_step(conn, item: dict, today: date) -> dict:
    from ..ai.news_classifier import classify_pending
    from .news_job import collect_news

    s = collect_news(conn, item_id=item["id"])
    if "skipped" in s:
        return s
    try:
        s["classify"] = classify_pending(conn, mode="sync", limit=15, item_id=item["id"])
    except Exception as e:  # 분류는 다음 매일 수집 때 다시 시도
        log.warning("뉴스 분류 실패: %s", e)
        s["classify"] = {"error": repr(e)}
    return s


STEP_FNS: dict[str, Callable[..., dict]] = {
    "trades": trades_step,
    "attrs": attrs_step,
    "location": location_step,
    "valuation": valuation_step,
    "news": news_step,
    "history": history_step,
}


def _set_step(conn, run_id: int, key: str, value: dict) -> None:
    conn.execute(
        "update item_collect_runs set steps = steps || jsonb_build_object(%s::text, %s::jsonb) where id = %s",
        (key, jsonb(value), run_id),
    )
    conn.commit()


def _now(conn) -> str:
    return conn.execute("select now()::text as t").fetchone()["t"]


def collect_item(conn, item: str, run: int | None = None, today: date | None = None) -> dict:
    """한 관심 부동산의 데이터를 단계별로 수집한다. run 이 없으면 새 실행 기록을 만든다(runner=cli)."""
    today = today or date.today()
    it = conn.execute(
        "select id::text as id, property_type, sgg_cd, lawd_cd, pnu, complex_id from watch_items where id = %s", (item,)
    ).fetchone()
    if not it:
        if run is None:
            return {"error": "not found"}
        conn.execute("update item_collect_runs set status = 'error', error = %s, finished_at = now() where id = %s",
                     ("부동산을 찾을 수 없습니다", run))
        conn.commit()
        return {"run": run, "error": "not found"}
    if run is None:
        run = conn.execute(
            "insert into item_collect_runs (watch_item_id, runner) values (%s, 'cli') returning id", (item,)
        ).fetchone()["id"]
        conn.commit()
    conn.execute("update item_collect_runs set status = 'running', started_at = now() where id = %s", (run,))
    conn.commit()

    result: dict = {"run": run}
    for key, _label in STEPS:
        started = _now(conn)
        _set_step(conn, run, key, {"status": "running", "started_at": started})
        try:
            if not it["sgg_cd"] and key in ("trades", "history"):
                detail = {"skipped": "시군구 코드가 없습니다"}
            else:
                detail = STEP_FNS[key](conn, dict(it), today) or {}
            status = "skipped" if "skipped" in detail and len(detail) == 1 else "done"
        except QuotaExceeded as e:
            conn.rollback()
            detail, status = {"error": str(e)}, "error"
        except Exception as e:  # 한 단계 실패가 나머지를 막지 않게
            conn.rollback()
            log.exception("개별 수집 %s 실패", key)
            detail, status = {"error": repr(e)[:500]}, "error"
        _set_step(conn, run, key, {"status": status, "detail": detail, "started_at": started, "finished_at": _now(conn)})
        result[key] = {"status": status, **detail}
        # 단지가 새로 연결되면 다음 단계(공시가격·추정 시세)에 반영
        if key == "trades":
            it = conn.execute(
                "select id::text as id, property_type, sgg_cd, lawd_cd, pnu, complex_id from watch_items where id = %s", (item,)
            ).fetchone() or it
    conn.execute("update item_collect_runs set status = 'done', finished_at = now() where id = %s", (run,))
    conn.commit()
    return result
