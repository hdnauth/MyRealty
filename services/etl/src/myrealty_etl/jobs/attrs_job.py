"""관심 부동산 속성 수집: 건축물대장, 토지특성·이용계획, 공시가격(월 1회 갱신)."""

from __future__ import annotations

import logging
import re

from ..collectors import building, vworld
from ..config import settings
from ..db import jsonb
from ..http import QuotaExceeded, explain_error

log = logging.getLogger(__name__)
BUILDING_TYPES = {"apt", "officetel", "rowhouse", "house", "commercial"}


def parse_dong_ho(s: str | None) -> tuple[str | None, str | None]:
    if not s:
        return None, None
    d = re.search(r"(\d+)\s*동", s)
    h = re.search(r"(\d+)\s*호", s)
    return (d.group(1) if d else None), (h.group(1) if h else None)


def save_building(conn, pnu: str, reg: dict, complex_id: int | None) -> None:
    conn.execute(
        """insert into building_registers (pnu, titles, recap, fetched_at) values (%s, %s, %s, now())
           on conflict (pnu) do update set titles = excluded.titles, recap = excluded.recap, fetched_at = now()""",
        (pnu, jsonb(reg["titles"]), jsonb(reg["recap"]) if reg["recap"] else None),
    )
    s = building.summarize(reg)
    # 단지가 아직 연결 전이어도 같은 필지(pnu)의 단지면 채운다
    conn.execute(
        """update complexes set households = coalesce(%s, households), build_year = coalesce(build_year, %s),
             pnu = coalesce(pnu, %s), updated_at = now() where id = %s or pnu = %s""",
        (s["households"], s["build_year"], pnu, complex_id, pnu),
    )


def save_parcel(conn, pnu: str, ch: dict | None, uses: list[dict]) -> None:
    conn.execute(
        """insert into parcels (pnu, lawd_cd, jimok, area_m2, land_use_zone, road_side, terrain_shape, terrain_height, land_uses, updated_at)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
           on conflict (pnu) do update set jimok = excluded.jimok, area_m2 = excluded.area_m2,
             land_use_zone = excluded.land_use_zone, road_side = excluded.road_side, terrain_shape = excluded.terrain_shape,
             terrain_height = excluded.terrain_height, land_uses = excluded.land_uses, updated_at = now()""",
        (pnu, pnu[:10], ch and ch["jimok"], ch and ch["area_m2"], (ch and ch["land_use_zone"]) or [],
         ch and ch["road_side"], ch and ch["terrain_shape"], ch and ch["terrain_height"], jsonb(uses)),
    )


def save_prices(conn, target_type: str, key: str, prices: list[dict]) -> int:
    for p in prices:
        conn.execute(
            """insert into official_prices (target_type, target_key, year, price, area_m2) values (%s, %s, %s, %s, %s)
               on conflict (target_type, target_key, year) do update set price = excluded.price, area_m2 = excluded.area_m2""",
            (target_type, key, p["year"], p["price"], p.get("area_m2")),
        )
    return len(prices)


def refresh_attrs(conn, max_age_days: int = 30, item_id: str | None = None) -> dict:
    """item_id 를 주면 그 부동산만(등록 직후 개별 수집)."""
    stats = {"buildings": 0, "parcels": 0, "prices": 0, "errors": 0, "skipped": []}
    if not settings.data_go_kr_key:
        stats["skipped"].append("건축물대장(DATA_GO_KR_KEY)")
    if not settings.vworld_key:
        stats["skipped"].append("토지·공시가격(VWORLD_KEY)")
    items = conn.execute(
        """select w.pnu, w.property_type, w.dong_ho, w.complex_id,
             -- 대장이 0건이면(지번 오류·일시 오류로 빈 결과가 저장된 경우 포함) 하루만 믿고 다시 받는다
             (select case when jsonb_array_length(b.titles) > 0 then b.fetched_at
                          else least(b.fetched_at, now() - interval '30 days' + interval '1 day') end
                from building_registers b where b.pnu = w.pnu) as b_at,
             -- 지목이 빈 행은(웹이 경계만 저장했거나 예전 조회 실패) 토지특성을 아직 못 받은 것 — 다시 받는다
             (select case when p.jimok is not null then p.updated_at end from parcels p where p.pnu = w.pnu) as p_at
           from watch_items w where w.pnu is not null and (%(id)s::uuid is null or w.id = %(id)s::uuid)""",
        {"id": item_id},
    ).fetchall()
    stale = f"{max_age_days} days"
    done_b, done_p = set(), set()
    def fail(what: str, pnu: str, e: Exception) -> None:
        conn.rollback()
        log.warning("%s 수집 실패 %s: %s", what, pnu, e)
        stats["errors"] += 1
        msg = f"{what}: {explain_error(e)}"
        if msg not in stats.setdefault("error_detail", []):
            stats["error_detail"].append(msg)

    try:
        for it in items:
            pnu = it["pnu"]
            # 건축물대장과 토지(브이월드)는 따로 — 한쪽 실패가 다른 쪽을 막지 않게
            if settings.data_go_kr_key and it["property_type"] in BUILDING_TYPES and pnu not in done_b:
                try:
                    fresh = conn.execute("select %s::timestamptz > now() - %s::interval as ok", (it["b_at"], stale)).fetchone()["ok"]
                    if not fresh:
                        save_building(conn, pnu, building.fetch(pnu, conn), it["complex_id"])
                        stats["buildings"] += 1
                    done_b.add(pnu)
                    conn.commit()
                except QuotaExceeded:
                    raise
                except Exception as e:
                    fail("건축물대장", pnu, e)
            if settings.vworld_key and pnu not in done_p:
                try:
                    fresh = conn.execute("select %s::timestamptz > now() - %s::interval as ok", (it["p_at"], stale)).fetchone()["ok"]
                    if not fresh:
                        ch = vworld.land_characteristics(pnu, conn)
                        save_parcel(conn, pnu, ch, vworld.land_uses(pnu, conn))
                        if ch and ch.get("area_m2"):
                            # 등록 때 면적을 못 받았으면(토지특성 조회 실패 등) 토지특성 면적으로 — 추정가·배율 계산에 필요
                            conn.execute(
                                """update watch_items set land_area_m2 = %s, updated_at = now()
                                   where pnu = %s and land_area_m2 is null and property_type in ('land', 'forest')""",
                                (ch["area_m2"], pnu),
                            )
                        stats["prices"] += save_prices(conn, "land", pnu, vworld.land_prices(pnu, conn))
                        if it["property_type"] in ("apt", "officetel", "rowhouse"):
                            dong, ho = parse_dong_ho(it["dong_ho"])
                            if dong or ho:
                                ps = vworld.apt_prices(pnu, dong, ho, conn)
                                stats["prices"] += save_prices(conn, "apt_unit", f"{pnu}|{dong or ''}|{ho or ''}", ps)
                        elif it["property_type"] == "house":
                            stats["prices"] += save_prices(conn, "house", pnu, vworld.house_prices(pnu, conn))
                        stats["parcels"] += 1
                    done_p.add(pnu)
                    conn.commit()
                except QuotaExceeded:
                    raise
                except Exception as e:
                    fail("토지·공시가격(브이월드)", pnu, e)
    except QuotaExceeded as e:
        log.warning("%s", e)
        stats["quota_stop"] = True
    return stats
