"""생활편의 점수(0~100)와 개발 요인 요약.

항목별 점수는 '가까울수록'(거리 체감) 또는 '많을수록'(포화 곡선)으로 계산해 가중 평균한다.
해당 카테고리 데이터가 20km 안에 전혀 없으면 '미수집'으로 보고 총점 계산에서 제외한다.

영역이 있는 시설(공원 등, pois.shape)은 중심이 아니라 경계까지 거리를 재고, 면적 항목은 반경 안에 실제로 겹치는
면적만 센다. 공원은 규모도 본다(큰 공원 바로 옆 = 100점, 어린이공원만 가까우면 그보다 낮게).
"""

from __future__ import annotations

import logging
from datetime import date

from ..db import jsonb

log = logging.getLogger(__name__)

# 항목: (라벨, 가중치, [구성요소]) — 구성요소: (종류, 카테고리 목록, 하위분류 필터, 파라미터, 비중)
#   near: 최근접 거리 good 이하 100점 → bad 이상 0점 선형
#   count: 반경 r 안 개수 / 포화 개수
#   area: 반경 r 안 면적 합 / 포화 면적
SPECS: dict[str, tuple[str, float, list[tuple]]] = {
    "transit": ("교통", 0.25, [("near", ["subway"], None, {"good": 300, "bad": 1500}, 0.7),
                              ("count", ["bus"], None, {"r": 500, "sat": 10}, 0.3)]),
    "school": ("학교", 0.15, [("near", ["school"], ["초등학교"], {"good": 300, "bad": 1200}, 0.6),
                             ("count", ["school"], ["중학교", "고등학교"], {"r": 1000, "sat": 4}, 0.4)]),
    "academy": ("학원", 0.10, [("count", ["academy"], None, {"r": 1000, "sat": 100}, 1.0)]),
    "medical": ("의료", 0.10, [("near", ["hospital"], ["상급종합", "상급종합병원", "종합병원"], {"good": 1000, "bad": 5000}, 0.5),
                              ("count", ["clinic"], None, {"r": 1000, "sat": 40}, 0.5)]),
    "shopping": ("쇼핑", 0.15, [("near", ["mart"], None, {"good": 500, "bad": 3000}, 0.6),
                               ("count", ["convenience"], None, {"r": 500, "sat": 8}, 0.4)]),
    "food": ("음식·카페", 0.10, [("count", ["food", "cafe"], None, {"r": 500, "sat": 120}, 1.0)]),
    "park": ("공원", 0.15, [("near", ["park"], None, {"good": 300, "bad": 1500, "sized": True}, 0.7),
                           ("area", ["park"], None, {"r": 1000, "sat": 100_000}, 0.3)]),
}


def park_size_factor(area_m2: float | None) -> float:
    """가까운 공원의 규모 인정 비율: 5ha 이상 1.0 · 1~5ha 0.85 · 1ha 미만(어린이·소공원) 0.6 · 면적 모름 0.7."""
    if area_m2 is None:
        return 0.7
    if area_m2 >= 50_000:
        return 1.0
    if area_m2 >= 10_000:
        return 0.85
    return 0.6

# 용도지역별 용적률 상한(서울시 도시계획 조례 기준, 참고용)
FAR_CAP = {"제1종전용주거지역": 100, "제2종전용주거지역": 120, "제1종일반주거지역": 150, "제2종일반주거지역": 200,
           "제3종일반주거지역": 250, "준주거지역": 400}
REBUILD_AGE = 30
# 단지 점수(백분위 비교용)를 계산하는 범위: 관심 부동산에서 이 거리 안(시설 수집 반경 안쪽)
COVER_M = 500

# d: 영역이 있으면 경계까지(안에 있으면 0), 없으면 점까지. area_1km: 반경 1km 원과 겹치는 면적(영역 없으면 area_m2)
POI_SQL = """
with pt as (select ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography as g)
select category, subcategory, name, area_m2::float8 as area_m2,
       ST_Distance(coalesce(shape, geom)::geography, pt.g) as d,
       case when shape is not null and category = 'park'
            then ST_Area(ST_Intersection(shape::geography, ST_Buffer(pt.g, 1000)))
            else area_m2::float8 end as area_1km
from pois, pt
where ST_DWithin(coalesce(shape, geom)::geography, pt.g, 5000)
"""


def linear(d: float, good: float, bad: float) -> float:
    if d <= good:
        return 100.0
    if d >= bad:
        return 0.0
    return 100.0 * (bad - d) / (bad - good)


def available_categories(conn, lng: float, lat: float) -> set[str]:
    rows = conn.execute(
        """select distinct category from pois
           where ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, 20000)""",
        (lng, lat),
    ).fetchall()
    return {r["category"] for r in rows}


def score_point(pois: list[dict], available: set[str]) -> tuple[float | None, dict]:
    result: dict = {}
    total_w = total = 0.0
    for key, (label, weight, comps) in SPECS.items():
        needed = {c for comp in comps for c in comp[1]}
        if not needed & available:
            result[key] = {"label": label, "score": None, "status": "미수집"}
            continue
        part_score, details = 0.0, []
        for kind, cats, subs, prm, share in comps:
            cand = [p for p in pois if p["category"] in cats and (subs is None or (p["subcategory"] or "") in subs)]
            if kind == "near":
                if prm.get("sized"):
                    # 거리 점수 × 규모 인정 비율이 가장 높은 곳(가까운 소공원보다 조금 먼 큰 공원이 나을 수 있다)
                    def val(p, good=prm["good"], bad=prm["bad"]):
                        return linear(p["d"], good, bad) * park_size_factor(p["area_m2"])
                    near = max(cand, key=val, default=None)
                    s = val(near) if near else 0.0
                else:
                    near = min(cand, key=lambda p: p["d"], default=None)
                    s = linear(near["d"], prm["good"], prm["bad"]) if near else 0.0
                details.append({"type": "near", "cats": cats, "subs": subs, "score": round(s, 1),
                                "name": near and near["name"], "dist_m": near and int(near["d"]),
                                **({"area_m2": round(near["area_m2"])} if near and near.get("area_m2") else {})})
            elif kind == "count":
                n = sum(1 for p in cand if p["d"] <= prm["r"])
                s = min(n / prm["sat"], 1.0) * 100
                details.append({"type": "count", "cats": cats, "subs": subs, "score": round(s, 1), "count": n, "radius": prm["r"]})
            else:
                a = sum(float(p.get("area_1km") or p["area_m2"] or 0) for p in cand if p["d"] <= prm["r"])
                s = min(a / prm["sat"], 1.0) * 100
                details.append({"type": "area", "cats": cats, "score": round(s, 1), "area_m2": round(a), "radius": prm["r"]})
            part_score += s * share
        result[key] = {"label": label, "score": round(part_score, 1), "weight": weight, "details": details}
        total += part_score * weight
        total_w += weight
    return (round(total / total_w, 1) if total_w else None), result


def development_summary(conn, lng: float, lat: float, *, build_year: int | None = None, vl_rat: float | None = None,
                        zones: list[str] | None = None, today: date | None = None) -> dict:
    today = today or date.today()
    pt = "ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography"
    zone_rows = conn.execute(
        f"""select id, name, kind, stage, stage_order, stage_date::text, households_plan,
              ST_Distance(geom::geography, {pt})::int as dist_m
            from redevelopment_zones
            where geom is not null and ST_DWithin(geom::geography, {pt}, 1500)
            order by dist_m limit 20""",
        {"lng": lng, "lat": lat},
    ).fetchall()
    infra_rows = conn.execute(
        f"""select id, name, kind, line_name, status, status_order, expected_open::text,
              ST_Distance(geom::geography, {pt})::int as dist_m
            from infra_projects
            where geom is not null and ST_DWithin(geom::geography, {pt}, 3000)
            order by dist_m limit 20""",
        {"lng": lng, "lat": lat},
    ).fetchall()
    planned = [r for r in infra_rows if r["status"] != "개통"]
    out: dict = {
        "zones": [dict(r) for r in zone_rows],
        "zones_count": len(zone_rows),
        "zones_advanced": sum(1 for r in zone_rows if (r["stage_order"] or 0) >= 5),  # 사업시행인가 이후
        "infra": [dict(r) for r in infra_rows],
        "nearest_planned_station": dict(planned[0]) if planned else None,
    }
    if planned and planned[0]["expected_open"]:
        out["months_to_open"] = max(0, (date.fromisoformat(planned[0]["expected_open"]) - today).days // 30)
    if build_year:
        age = today.year - build_year
        out["rebuild"] = {"age": age, "eligible": age >= REBUILD_AGE, "years_left": max(0, REBUILD_AGE - age)}
    cap = next((FAR_CAP[z] for z in (zones or []) if z in FAR_CAP), None)
    if vl_rat and cap:
        out["far"] = {"current": vl_rat, "cap": cap, "headroom": round(cap - vl_rat, 1)}
    return out


def score_target(conn, target_type: str, target_id: str, lng: float, lat: float, avail: set[str], **dev) -> float | None:
    pois = conn.execute(POI_SQL, {"lng": lng, "lat": lat}).fetchall()
    total, scores = score_point(pois, avail)
    development = development_summary(conn, lng, lat, **dev)
    conn.execute(
        """insert into location_scores (target_type, target_id, total, scores, development, computed_at)
           values (%s, %s, %s, %s, %s, now())
           on conflict (target_type, target_id) do update set total = excluded.total, scores = excluded.scores,
             development = excluded.development, computed_at = now()""",
        (target_type, target_id, total, jsonb(scores), jsonb(development)),
    )
    return total


def compute_locations(conn, item_id: str | None = None) -> dict:
    stats = {"items": 0, "complexes": 0}
    items = conn.execute(
        """select w.id, ST_X(w.geom) as lng, ST_Y(w.geom) as lat,
             coalesce(c.build_year, (select min(left(t->>'approved_at', 4))::int from building_registers b,
                jsonb_array_elements(b.titles) t where b.pnu = w.pnu and t->>'approved_at' is not null)) as build_year,
             (select (b.recap->>'vl_rat')::float8 from building_registers b where b.pnu = coalesce(c.pnu, w.pnu)) as vl_rat,
             (select p.land_use_zone from parcels p where p.pnu = coalesce(c.pnu, w.pnu)) as zones
           from watch_items w left join complexes c on c.id = w.complex_id
           where w.geom is not null and (%(id)s::uuid is null or w.id = %(id)s::uuid)""",
        {"id": item_id},
    ).fetchall()
    avail_cache: dict = {}
    for it in items:
        k = (round(it["lng"], 1), round(it["lat"], 1))
        avail = avail_cache.setdefault(k, available_categories(conn, it["lng"], it["lat"]))
        score_target(conn, "item", str(it["id"]), it["lng"], it["lat"], avail, build_year=it["build_year"],
                     vl_rat=it["vl_rat"], zones=it["zones"])
        stats["items"] += 1
    # 주변 단지도 계산해 백분위 비교에 쓴다. 시설은 관심 부동산 주변(상가 1.5km·OSM 2km)만 모으므로
    # 그보다 먼 단지는 시설이 덜 잡혀 점수가 낮게 나온다 — 관심 부동산 COVER_M 안 단지만 계산하고, 밖의 예전 점수는 지운다
    conn.execute(
        """delete from location_scores s where s.target_type = 'complex' and not exists (
             select 1 from complexes c join watch_items w on w.geom is not null
             where c.id::text = s.target_id and c.geom is not null
               and ST_DWithin(c.geom::geography, w.geom::geography, %s))""",
        (COVER_M,),
    )
    cxs = conn.execute(
        """select distinct c.id, ST_X(c.geom) as lng, ST_Y(c.geom) as lat, c.build_year from complexes c
           join watch_items w on w.geom is not null and ST_DWithin(c.geom::geography, w.geom::geography, %(cover)s)
           where c.geom is not null and c.property_type = 'apt'
             and (%(id)s::uuid is null or w.id = %(id)s::uuid)""",
        {"id": item_id, "cover": COVER_M},
    ).fetchall()
    for c in cxs:
        k = (round(c["lng"], 1), round(c["lat"], 1))
        avail = avail_cache.setdefault(k, available_categories(conn, c["lng"], c["lat"]))
        score_target(conn, "complex", str(c["id"]), c["lng"], c["lat"], avail, build_year=c["build_year"])
        stats["complexes"] += 1
    conn.commit()
    return stats
