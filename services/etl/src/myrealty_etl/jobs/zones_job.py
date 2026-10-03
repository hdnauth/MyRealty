"""정비구역 수집·분석 묶음(매일 파이프라인 `zones` 단계).

순서: 서울 정보몽땅 → 서울 구역 경계 → 경기 → 부산 → 인천 → 시·군·구 파일 → 국토부 전국 통합(앞의 것과 이름 맞춤)
→ 구역 ↔ 단지 연결 → 단계 효과. 한 출처가 실패해도(차단·화면 변경) 나머지는 계속한다.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from ..analytics.zones import link_zone_complexes, stage_effects
from ..collectors.molit_zones import collect_molit_zones
from ..collectors.seoul_boundaries import collect_seoul_boundaries
from ..collectors.seoul_cleanup import collect_seoul_zones
from ..collectors.zones_regional import collect_busan, collect_files, collect_gyeonggi, collect_incheon
from ..http import explain_error

log = logging.getLogger(__name__)

STEPS: list[tuple[str, Callable]] = [
    ("seoul", collect_seoul_zones),
    ("seoul_boundaries", collect_seoul_boundaries),
    ("gyeonggi", collect_gyeonggi),
    ("busan", collect_busan),
    ("incheon", collect_incheon),
    ("files", collect_files),
    ("molit", collect_molit_zones),
    ("link", link_zone_complexes),
    ("effects", stage_effects),
]


def collect_zones(conn, only: list[str] | None = None) -> dict:
    out: dict = {}
    for name, fn in STEPS:
        if only and name not in only:
            continue
        try:
            out[name] = fn(conn)
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
