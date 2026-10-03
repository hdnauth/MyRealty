"""정비구역 수집·분석 묶음(매일 파이프라인 `zones` 단계).

순서: 서울 정보몽땅 → 서울 구역 경계 → 경기 → 부산 → 인천 → 시·군·구 파일 → 국토부 전국 통합(앞의 것과 이름 맞춤)
→ 위치 확인·이어 찾기 → 토지이용계획 경계·후보지 → 구역 ↔ 단지 연결 → 단계 효과. 한 출처가 실패해도(차단·화면 변경) 나머지는 계속한다.

부하: 정비사업 단계는 몇 달에 한 번 바뀌므로 매일 모든 사이트를 읽지 않는다. 출처마다 마지막 성공 뒤 INTERVAL_DAYS 가 지나야
다시 받고(poi_fetches 'zones:<출처>'), 단지 연결·단계 효과는 새로 들어오거나 바뀐 구역이 있을 때만(아니면 30일마다) 다시 계산한다.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from ..analytics.zones import link_zone_complexes, stage_effects
from ..collectors.landuse_zones import collect_landuse_zones
from ..collectors.molit_zones import collect_molit_zones
from ..collectors.seoul_boundaries import collect_seoul_boundaries
from ..collectors.seoul_cleanup import collect_seoul_zones
from ..collectors.zone_common import locate_pending, verify_locations
from ..collectors.zones_regional import collect_busan, collect_files, collect_gyeonggi, collect_incheon
from ..http import explain_error

log = logging.getLogger(__name__)

# 출처별 최소 간격(일). 단계 목록은 단계 변화 알림이 늦지 않게 3일, 국가·파일 자료는 분기마다 갱신돼 30일.
# 서울 구역 경계는 수집기가 자체로 25일 간격을 둔다
INTERVAL_DAYS = {"seoul": 3, "seoul_boundaries": 0, "gyeonggi": 3, "busan": 3, "incheon": 3, "files": 30, "molit": 30, "verify": 0,
                 "locate": 0, "landuse": 0}
ANALYSIS = {"link", "effects"}
ANALYSIS_MAX_DAYS = 30


def _due(conn, name: str, days: int) -> bool:
    if days <= 0:
        return True
    r = conn.execute(
        "select fetched_at > now() - make_interval(days => %s) as fresh from poi_fetches where key = %s", (days, f"zones:{name}")
    ).fetchone()
    return not (r and r["fresh"])


def _mark(conn, name: str, count: int) -> None:
    conn.execute(
        """insert into poi_fetches (key, fetched_at, count) values (%s, now(), %s)
           on conflict (key) do update set fetched_at = now(), count = excluded.count""",
        (f"zones:{name}", count),
    )
    conn.commit()


def _changed(res: object) -> int:
    if not isinstance(res, dict):
        return 0
    # 새로 위치를 찾은 구역도 단지 연결을 다시 해야 한다
    return int(res.get("new", 0) or 0) + int(res.get("changed", 0) or 0) + int(res.get("located", 0) or 0)

STEPS: list[tuple[str, Callable]] = [
    ("seoul", collect_seoul_zones),
    ("seoul_boundaries", collect_seoul_boundaries),
    ("gyeonggi", collect_gyeonggi),
    ("busan", collect_busan),
    ("incheon", collect_incheon),
    ("files", collect_files),
    ("molit", collect_molit_zones),
    # 이름 검색으로 찾은 위치가 그 시군구 안인지 확인(한 번만 — 확인한 곳은 표시해 둔다)
    ("verify", verify_locations),
    # 좌표 없는 구역 이어서 찾기(출처를 다시 받지 않는다 — 찾을 곳이 없으면 바로 끝난다)
    ("locate", locate_pending),
    # 토지이용계획 필지로 경계 붙이기·후보지(격자마다 45일 간격, 한 실행 격자 상한 — 받을 격자가 없으면 덩어리 계산만)
    ("landuse", collect_landuse_zones),
    ("link", link_zone_complexes),
    ("effects", stage_effects),
]


def collect_zones(conn, only: list[str] | None = None, force: bool = False) -> dict:
    out: dict = {}
    changed = 0
    for name, fn in STEPS:
        if only and name not in only:
            continue
        if name in ANALYSIS:
            # 바뀐 구역이 없으면 연결·효과는 그대로(30일마다 한 번은 다시 계산)
            if not (force or only or changed or _due(conn, name, ANALYSIS_MAX_DAYS)):
                out[name] = {"skipped": "변경 없음"}
                continue
        elif not (force or only or _due(conn, name, INTERVAL_DAYS.get(name, 1))):
            out[name] = {"skipped": f"{INTERVAL_DAYS.get(name, 1)}일 안에 받음"}
            continue
        try:
            out[name] = fn(conn)
            changed += _changed(out[name])
            _mark(conn, name, _changed(out[name]))
        except Exception as e:  # 한 출처 실패가 전체를 막지 않도록
            conn.rollback()
            log.exception("zones %s 실패", name)
            out[name] = {"error": explain_error(e)}
    out["total"] = conn.execute(
        """select count(*)::int as n, count(*) filter (where geom is not null)::int as located,
             count(*) filter (where GeometryType(geom) like '%%POLYGON')::int as boundaries
           from redevelopment_zones"""
    ).fetchone()
    return out
