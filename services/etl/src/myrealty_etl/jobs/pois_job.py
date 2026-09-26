"""관심 물건 주변 POI 수집(30일마다) → 입지 점수 계산."""

from __future__ import annotations

import logging

from ..analytics.location import compute_locations
from ..collectors import pois
from ..config import settings
from ..http import QuotaExceeded

log = logging.getLogger(__name__)


def collect_pois(conn, max_age_days: int = 30) -> dict:
    stats = {"semas": 0, "hira": 0, "points": 0}
    if settings.data_go_kr_key:
        pts = conn.execute("select distinct round(ST_X(geom)::numeric, 3)::float8 as lng, round(ST_Y(geom)::numeric, 3)::float8 as lat "
                           "from watch_items where geom is not null").fetchall()
        try:
            for p in pts:
                for source, radius, fn in (("semas", 1000, pois.fetch_semas), ("hira", 5000, pois.fetch_hira)):
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
        stats["skipped"] = "DATA_GO_KR_KEY 미설정(표준데이터 CSV 는 import-poi 로 가져올 수 있음)"
    stats["scores"] = compute_locations(conn)
    return stats
