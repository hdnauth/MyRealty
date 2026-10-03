"""주변 시설(POI) 수집(30일마다) → 입지 점수 계산.

두 단위로 모은다.
- 관심 부동산 지점: 상가 1.5km·병원 5km·OSM 2km(밀집 시설 700m) — 예전과 같다.
- 단지 격자(0.01°, 약 0.9×1.1km): 수집 지역의 아파트 단지가 있는 칸마다 칸 중심에서 상가 1.8km·병원 6km·OSM 2.5km(밀집 1.8km).
  칸 중심에서 가장 먼 단지까지 약 0.71km 이므로, 칸 안 모든 단지의 '1km 안 학원·의원·음식점' 개수를 빠짐없이 센다.
  칸을 다 받으면 poi_cells 에 적고, 그 칸의 단지는 입지 점수를 계산한다(analytics/location.covered_complexes).
"""

from __future__ import annotations

import logging
import time

from ..analytics.location import CELL, compute_locations
from ..collectors import pois
from ..config import settings
from ..http import QuotaExceeded

log = logging.getLogger(__name__)

# (원천, 반경) — 관심 부동산 지점 / 단지 격자 중심
ITEM_SITE = {"semas": 1500, "hira": 5000, "osm": 2000, "osm_small": 700}
CELL_SITE = {"semas": 1800, "hira": 6000, "osm": 2500, "osm_small": 1800}
# 하루 실행에서 새로 받을 격자 수(공공 API 호출 = 칸마다 상가 2~5쪽 + 병원 3회). 나머지는 다음 날로
MAX_CELLS = 30


def _fresh(conn, key: str, max_age_days: int) -> bool:
    return bool(conn.execute("select 1 from poi_fetches where key = %s and fetched_at > now() - %s::interval",
                             (key, f"{max_age_days} days")).fetchone())


def _mark(conn, key: str, n: int) -> None:
    conn.execute(
        """insert into poi_fetches (key, fetched_at, count) values (%s, now(), %s)
           on conflict (key) do update set fetched_at = now(), count = excluded.count""",
        (key, n),
    )
    conn.commit()


def fetch_site(conn, lng: float, lat: float, radii: dict, max_age_days: int, stats: dict) -> set[str]:
    """한 지점 주변을 원천별로 받는다(30일 안에 받은 원천은 건너뜀). → 받았거나 이미 신선한 원천.
    공공 API 일일 한도에 걸리면 QuotaExceeded 를 그대로 올린다(남은 지점은 다음 실행으로)."""
    done: set[str] = set()
    if settings.data_go_kr_key:
        for source, fn in (("semas", pois.fetch_semas), ("hira", pois.fetch_hira)):
            key = f"{source}:{lng:.3f}:{lat:.3f}:{radii[source]}"
            if _fresh(conn, key, max_age_days):
                done.add(source)
                continue
            try:
                rows = fn(lng, lat, radii[source], conn)
            except QuotaExceeded:
                raise
            except Exception as e:
                log.warning("POI 수집 실패 %s: %s", key, e)
                continue
            stats[source] = stats.get(source, 0) + pois.upsert_pois(conn, rows)
            _mark(conn, key, len(rows))
            done.add(source)
    # OSM: 키 없이 — 공공 API 가 막혀도 입지 점수·지도 레이어가 비지 않도록. osm2 = 공원 영역(경계)까지 받는 버전
    from ..collectors import osm

    small = radii["osm_small"]
    key = f"osm2:{lng:.3f}:{lat:.3f}:{radii['osm']}" + ("" if small == 700 else f":{small}")
    if _fresh(conn, key, max_age_days):
        done.add("osm")
    else:
        try:
            rows = osm.fetch(lng, lat, radii["osm"], small)
            stats["osm"] = stats.get("osm", 0) + pois.upsert_pois(conn, rows)
            _mark(conn, key, len(rows))
            done.add("osm")
        except Exception as e:
            log.warning("OSM 시설 수집 실패 %s: %s", key, e)
    return done


def cell_complete(done: set[str]) -> bool:
    """격자를 '다 받았다'고 볼 조건: 키가 있으면 상가정보(밀집 시설의 주 원천)까지, 없으면 OSM 만으로."""
    return ("semas" in done) if settings.data_go_kr_key else ("osm" in done)


def collect_cells(conn, max_age_days: int = 30, max_cells: int = MAX_CELLS, deadline: float | None = None) -> dict:
    """수집 지역 아파트 단지가 있는 격자 중 아직 안 받았거나 오래된 칸을 단지 많은 순으로 받는다."""
    stats: dict = {"cells": 0, "pending": 0}
    cells = conn.execute(
        f"""select g.cx, g.cy, g.n from (
              select floor(ST_X(geom) / {CELL})::int as cx, floor(ST_Y(geom) / {CELL})::int as cy, count(*) as n
              from complexes where geom is not null and property_type = 'apt' group by 1, 2) g
            left join poi_cells pc on pc.cx = g.cx and pc.cy = g.cy
            where pc.cx is null or pc.fetched_at < now() - %s::interval
            order by (pc.cx is null) desc, g.n desc""",
        (f"{max_age_days} days",),
    ).fetchall()
    for i, c in enumerate(cells):
        if stats["cells"] >= max_cells or (deadline is not None and time.monotonic() >= deadline):
            stats["pending"] = len(cells) - i
            break
        lng, lat = (c["cx"] + 0.5) * CELL, (c["cy"] + 0.5) * CELL
        try:
            done = fetch_site(conn, lng, lat, CELL_SITE, max_age_days, stats)
        except QuotaExceeded as e:
            log.warning("%s", e)
            stats["quota_stop"] = True
            stats["pending"] = len(cells) - i
            break
        if cell_complete(done):
            conn.execute(
                """insert into poi_cells (cx, cy, sources, fetched_at) values (%s, %s, %s, now())
                   on conflict (cx, cy) do update set sources = excluded.sources, fetched_at = now()""",
                (c["cx"], c["cy"], sorted(done)),
            )
            conn.commit()
            stats["cells"] += 1
    return stats


def collect_pois(conn, max_age_days: int = 30, item_id: str | None = None, deadline: float | None = None) -> dict:
    """item_id 를 주면 그 부동산 주변만 모으고 점수도 그 부동산(과 주변 단지)만 계산한다.
    아니면 관심 부동산 지점 → 단지 격자 순으로 모으고, 시설이 갖춰진 단지 점수를 모두 계산한다."""
    stats: dict = {"points": 0}
    if not settings.data_go_kr_key:
        stats["skipped_public"] = "DATA_GO_KR_KEY 미설정(표준데이터 CSV 는 import-poi 로 가져올 수 있음)"
    pts = conn.execute("select distinct round(ST_X(geom)::numeric, 3)::float8 as lng, round(ST_Y(geom)::numeric, 3)::float8 as lat "
                       "from watch_items where geom is not null and (%(id)s::uuid is null or id = %(id)s::uuid)",
                       {"id": item_id}).fetchall()
    try:
        for p in pts:
            fetch_site(conn, p["lng"], p["lat"], ITEM_SITE, max_age_days, stats)
            stats["points"] += 1
    except QuotaExceeded as e:
        log.warning("%s", e)
        stats["quota_stop"] = True
    if item_id is None and not stats.get("quota_stop"):
        stats["grid"] = collect_cells(conn, max_age_days, deadline=deadline)
    stats["scores"] = compute_locations(conn, item_id=item_id)
    return stats
