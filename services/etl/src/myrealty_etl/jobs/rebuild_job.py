"""재건축 후보 단지 속성 수집: 준공 27년 이상 아파트 단지의 건축물대장(용적률·대지면적·세대수)과 토지(용도지역).

관심 부동산이 아닌 단지도 '재건축 후보' 테마에서 용적률 여유·세대당 대지지분을 보이려면 대장이 필요하다.
호출량을 지키려고 실행마다 limit 곳씩, 180일 지난 것만 다시 받는다.
"""

from __future__ import annotations

import logging
from datetime import date

from ..collectors import building, vworld
from ..config import settings
from ..http import QuotaExceeded, explain_error
from .attrs_job import save_building, save_parcel

log = logging.getLogger(__name__)

MIN_AGE = 27


def collect_rebuild_attrs(conn, limit: int = 60) -> dict:
    stats = {"candidates": 0, "buildings": 0, "parcels": 0, "errors": 0}
    if not settings.data_go_kr_key and not settings.vworld_key:
        return {"skipped": "DATA_GO_KR_KEY·VWORLD_KEY"}
    rows = conn.execute(
        """select c.id, c.pnu,
             (select fetched_at from building_registers b where b.pnu = c.pnu) as b_at,
             (select updated_at from parcels p where p.pnu = c.pnu and p.land_use_zone is not null) as p_at
           from complexes c
           where c.property_type = 'apt' and c.pnu is not null and length(c.pnu) = 19 and c.build_year <= %s
             and coalesce(c.households, 100) >= 100
           order by coalesce((select fetched_at from building_registers b where b.pnu = c.pnu), 'epoch'), c.households desc nulls last
           limit %s""",
        (date.today().year - MIN_AGE, limit * 3),
    ).fetchall()
    stats["candidates"] = len(rows)
    done = 0
    try:
        for r in rows:
            if done >= limit:
                break
            stale = "180 days"
            need_b = settings.data_go_kr_key and not conn.execute(
                "select %s::timestamptz > now() - %s::interval as ok", (r["b_at"], stale)).fetchone()["ok"]
            need_p = settings.vworld_key and not conn.execute(
                "select %s::timestamptz > now() - %s::interval as ok", (r["p_at"], stale)).fetchone()["ok"]
            if not (need_b or need_p):
                continue
            done += 1
            try:
                if need_b:
                    save_building(conn, r["pnu"], building.fetch(r["pnu"], conn), r["id"])
                    stats["buildings"] += 1
                if need_p:
                    save_parcel(conn, r["pnu"], vworld.land_characteristics(r["pnu"], conn), vworld.land_uses(r["pnu"], conn))
                    stats["parcels"] += 1
                conn.commit()
            except QuotaExceeded:
                raise
            except Exception as e:
                conn.rollback()
                stats["errors"] += 1
                log.warning("재건축 후보 속성 실패 %s: %s", r["pnu"], explain_error(e))
    except QuotaExceeded as e:
        log.warning("%s", e)
        stats["quota_stop"] = True
    return stats
