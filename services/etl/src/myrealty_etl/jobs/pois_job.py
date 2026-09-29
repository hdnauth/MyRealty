"""관심 부동산 주변 POI 수집(30일마다) → 입지 점수 계산."""

from __future__ import annotations

import logging

from ..analytics.location import compute_locations
from ..collectors import pois
from ..config import settings
from ..http import QuotaExceeded

log = logging.getLogger(__name__)


def collect_osm(conn, max_age_days: int = 30, item_id: str | None = None) -> int:
    """OpenStreetMap 주변 시설(키 없이). 공공 API 가 막혀도 입지 점수·지도 레이어가 비지 않도록."""
    from ..collectors import osm

    pts = conn.execute("select distinct round(ST_X(geom)::numeric, 3)::float8 as lng, round(ST_Y(geom)::numeric, 3)::float8 as lat "
                       "from watch_items where geom is not null and (%(id)s::uuid is null or id = %(id)s::uuid)",
                       {"id": item_id}).fetchall()
    n = 0
    for p in pts:
        # osm2: 공원 영역(경계)까지 받는 버전 — 예전(점만) 수집분을 다시 받는다
        key = f"osm2:{p['lng']:.3f}:{p['lat']:.3f}:2000"
        if conn.execute("select 1 from poi_fetches where key = %s and fetched_at > now() - %s::interval",
                        (key, f"{max_age_days} days")).fetchone():
            continue
        try:
            rows = osm.fetch(p["lng"], p["lat"], 2000)
        except Exception as e:
            log.warning("OSM 시설 수집 실패 %s: %s", key, e)
            continue
        n += pois.upsert_pois(conn, rows)
        conn.execute(
            """insert into poi_fetches (key, fetched_at, count) values (%s, now(), %s)
               on conflict (key) do update set fetched_at = now(), count = excluded.count""",
            (key, len(rows)),
        )
        conn.commit()
    return n


def collect_pois(conn, max_age_days: int = 30, item_id: str | None = None) -> dict:
    """item_id 를 주면 그 부동산 주변만 모으고 점수도 그 부동산(과 같은 시군구 단지)만 계산한다."""
    stats = {"semas": 0, "hira": 0, "points": 0}
    if settings.data_go_kr_key:
        pts = conn.execute("select distinct round(ST_X(geom)::numeric, 3)::float8 as lng, round(ST_Y(geom)::numeric, 3)::float8 as lat "
                           "from watch_items where geom is not null and (%(id)s::uuid is null or id = %(id)s::uuid)",
                           {"id": item_id}).fetchall()
        try:
            for p in pts:
                # 상가 1.5km: 주변 단지(500m 안)의 '1km 내 학원·의원' 개수까지 빠짐없이 세려면 1km + 500m
                for source, radius, fn in (("semas", 1500, pois.fetch_semas), ("hira", 5000, pois.fetch_hira)):
                    key = f"{source}:{p['lng']:.3f}:{p['lat']:.3f}:{radius}"
                    fresh = conn.execute(
                        "select 1 from poi_fetches where key = %s and fetched_at > now() - %s::interval",
                        (key, f"{max_age_days} days"),
                    ).fetchone()
                    if fresh:
                        continue
                    try:
                        rows = fn(p["lng"], p["lat"], radius, conn)
                    except QuotaExceeded:
                        raise
                    except Exception as e:
                        log.warning("POI 수집 실패 %s: %s", key, e)
                        continue
                    stats[source] += pois.upsert_pois(conn, rows)
                    conn.execute(
                        """insert into poi_fetches (key, fetched_at, count) values (%s, now(), %s)
                           on conflict (key) do update set fetched_at = now(), count = excluded.count""",
                        (key, len(rows)),
                    )
                    conn.commit()
                stats["points"] += 1
        except QuotaExceeded as e:
            log.warning("%s", e)
            stats["quota_stop"] = True
    else:
        stats["skipped_public"] = "DATA_GO_KR_KEY 미설정(표준데이터 CSV 는 import-poi 로 가져올 수 있음)"
    stats["osm"] = collect_osm(conn, max_age_days, item_id)
    stats["scores"] = compute_locations(conn, item_id=item_id)
    return stats
