"""생활편의 점수(0~100)와 개발 요인 요약.

항목(교통·직주근접·학교·쇼핑·공원·학원·의료·음식)은 여러 구성요소의 가중 평균이고, 총점은 항목의 가중 평균이다.

- near  : 가장 가까운(공원은 거리·규모로 본 가장 좋은) 시설까지 거리 — good 이하 100점 → bad 이상 0점 선형
- count : 반경 r 안 시설 '유효 개수'(거리 가중: r/2 안은 1개, r/2~r 은 1→0 으로 줄여 센다)를
          포화 곡선 100·(1−e^(−n/k)) 로 바꾼다. k 는 수도권 주거지 보통 수준(→ 약 63점)이라 도심 상권·학원가처럼
          훨씬 많은 곳과 한적한 곳이 모두 구별된다(예전의 'n/포화개수, 100점 상한'은 도시에서 거의 다 만점이었다).
- area  : 반경 1km 원과 겹치는 공원 면적 — 같은 포화 곡선
- lines : 걸어갈 만한 역(1.2km 안)의 노선 수·환승 여부(같은 이름 역을 묶어 노선을 센다)
- jobs  : 주요 업무지구까지 직선거리(지역 거점일수록 가중 낮음). 시설 자료가 필요 없어 항상 계산된다.

데이터가 20km 안에 전혀 없는 카테고리의 구성요소는 '미수집'으로 빼고 나머지 비중으로 다시 나눈다
(버스정류장만 없는데 교통 점수가 깎이지 않도록). 항목의 모든 구성요소가 미수집이면 항목 전체를 총점에서 뺀다.

영역이 있는 시설(공원 등, pois.shape)은 중심이 아니라 경계까지 거리를 재고, 면적 항목은 반경 안에 실제로 겹치는
면적만 센다. 공원은 규모도 본다(큰 공원 바로 옆 = 100점, 어린이공원만 가까우면 그보다 낮게).
"""

from __future__ import annotations

import logging
import math
import re
from datetime import date

from ..db import jsonb

log = logging.getLogger(__name__)

SUPERMARKET = ("슈퍼", "supermarket")
BIG_STORE_EXCLUDE = SUPERMARKET + ("편의점",)

# 항목: (라벨, 가중치, [구성요소]) — 구성요소: (종류, 카테고리 목록, 하위분류 필터, 파라미터, 비중)
#   하위분류 필터: None(전부) · 목록(정확히 일치) · {"like": [...]}(포함) · {"unlike": [...]}(제외)
SPECS: dict[str, tuple[str, float, list[tuple]]] = {
    "transit": ("교통", 0.20, [("near", ["subway"], None, {"good": 250, "bad": 1200}, 0.55),
                              ("lines", ["subway"], None, {"walk": 1200}, 0.15),
                              ("count", ["bus"], None, {"r": 500, "k": 7}, 0.30)]),
    "jobs": ("직주근접", 0.20, [("jobs", [], None, {}, 1.0)]),
    "school": ("학교", 0.12, [("near", ["school"], ["초등학교"], {"good": 250, "bad": 1000}, 0.6),
                             ("count", ["school"], ["중학교", "고등학교"], {"r": 1000, "k": 2.5}, 0.4)]),
    "shopping": ("쇼핑", 0.10, [("near", ["mart"], {"unlike": BIG_STORE_EXCLUDE}, {"good": 500, "bad": 3000, "label": "대형마트·백화점"}, 0.5),
                               ("count", ["mart"], {"like": SUPERMARKET}, {"r": 500, "k": 2, "label": "슈퍼마켓"}, 0.25),
                               ("count", ["convenience"], None, {"r": 500, "k": 6}, 0.25)]),
    "park": ("공원", 0.12, [("near", ["park"], None, {"good": 300, "bad": 1500, "sized": True}, 0.7),
                           ("area", ["park"], None, {"r": 1000, "k": 80_000}, 0.3)]),
    "academy": ("학원", 0.10, [("count", ["academy"], None, {"r": 1000, "k": 90}, 1.0)]),
    "medical": ("의료", 0.08, [("near", ["hospital"], ["상급종합", "상급종합병원", "종합병원"], {"good": 1000, "bad": 5000}, 0.4),
                              ("count", ["clinic"], {"unlike": ("치과", "한의", "요양")}, {"r": 1000, "k": 20, "label": "의원"}, 0.4),
                              ("count", ["clinic"], {"like": ("치과", "한의")}, {"r": 1000, "k": 12, "label": "치과·한의원"}, 0.2)]),
    "food": ("음식·카페", 0.08, [("count", ["food", "cafe"], None, {"r": 500, "k": 100}, 1.0)]),
}

# 주요 업무지구(대표 지점, 참고용 좌표): (이름, 경도, 위도, 가중, 도심 여부)
#   가중 — 서울 3대 업무지구 1.0, 수도권 신흥·산업 거점 0.5~0.9, 지방 거점 0.6~0.8
#   도심 — 서울 3대 업무지구와 지방 광역시 도심. 직주근접 = 도심 접근성 50% + 모든 거점 접근성 50%
#   (산업단지 바로 옆이라도 도심과 멀면 가격 수준이 다르다 — 예: 동탄 vs 수지)
JOB_CENTERS: list[tuple[str, float, float, float, bool]] = [
    ("강남(GBD)", 127.0276, 37.4979, 1.0, True),
    ("광화문·시청(CBD)", 126.9769, 37.5714, 1.0, True),
    ("여의도(YBD)", 126.9246, 37.5219, 1.0, True),
    ("판교", 127.1112, 37.4020, 0.9, False),
    ("마곡", 126.8350, 37.5600, 0.8, False),
    ("가산·구로디지털", 126.8826, 37.4816, 0.75, False),
    ("상암DMC", 126.8895, 37.5779, 0.75, False),
    ("성수", 127.0560, 37.5446, 0.75, False),
    ("수원 영통(삼성)", 127.0550, 37.2560, 0.65, False),
    ("기흥·동탄(반도체)", 127.0730, 37.2110, 0.6, False),
    ("송도", 126.6566, 37.3925, 0.7, False),
    ("평택 고덕", 127.0490, 37.0240, 0.5, False),
    ("세종 정부청사", 127.2590, 36.5040, 0.65, True),
    ("대전 둔산", 127.3845, 36.3510, 0.7, True),
    ("대구 도심", 128.5950, 35.8690, 0.75, True),
    ("부산 서면", 129.0592, 35.1578, 0.8, True),
    ("부산 센텀", 129.1300, 35.1690, 0.7, False),
    ("울산 삼산", 129.3380, 35.5390, 0.7, True),
    ("광주 상무", 126.8510, 35.1520, 0.7, True),
    ("창원 상남", 128.6810, 35.2230, 0.6, True),
]
JOB_FREE_M = 1500     # 이 거리까지는 감점 없음
JOB_DECAY_M = 12_000  # 그 뒤로 e^(−초과/λ) — 업무지구에서 +12km 마다 약 37% 로
JOB_SECOND = 0.3      # 두 번째로 가까운 업무지구의 보탬 비율(두 업무지구 사이 = 선택지가 많다)
JOB_CORE_SHARE = 0.5

LINE_VALUE = {1: 45.0, 2: 80.0}  # 3개 이상 100


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
select source, source_id, category, subcategory, name, area_m2::float8 as area_m2, attrs->>'line' as line,
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


def saturate(n: float, k: float) -> float:
    """포화 곡선: n = k 에서 약 63점, 2k 에서 86점, 3k 에서 95점."""
    return 100.0 * (1.0 - math.exp(-max(n, 0.0) / k)) if k > 0 else 0.0


def decay_weight(d: float, r: float) -> float:
    """거리 가중(유효 개수): r/2 안은 1, r/2~r 은 1→0 선형, r 밖은 0."""
    if d <= r / 2:
        return 1.0
    if d >= r:
        return 0.0
    return 2.0 * (r - d) / r


def haversine_m(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(a))


def job_access(lng: float, lat: float) -> tuple[float, dict]:
    """주요 업무지구 접근성(0~100) = 도심 접근성 50% + 모든 거점 접근성 50%.
    모든 거점 쪽은 가장 좋은 곳에 두 번째 곳을 조금 보탠다(확률 합 방식, 100 상한)."""
    cand = []
    for name, x, y, w, core in JOB_CENTERS:
        d = haversine_m(lng, lat, x, y)
        cand.append((w * 100.0 * math.exp(-max(0.0, d - JOB_FREE_M) / JOB_DECAY_M), name, d, core))
    cand.sort(reverse=True)
    (s1, n1, d1, _), (s2, n2, d2, _) = cand[0], cand[1]
    any_s = 100.0 * (1 - (1 - s1 / 100) * (1 - JOB_SECOND * s2 / 100))
    cs, cn, cd, _ = next(c for c in cand if c[3])
    score = JOB_CORE_SHARE * cs + (1 - JOB_CORE_SHARE) * any_s
    return score, {"type": "jobs", "score": round(score, 1), "name": n1, "dist_m": int(d1),
                   "second": {"name": n2, "dist_m": int(d2)}, "core": {"name": cn, "dist_m": int(cd), "score": round(cs, 1)}}


def station_key(name: str | None) -> str:
    """같은 역 묶기용 이름: 괄호·공백·끝의 '역' 제거(잠실역(2호선) → 잠실)."""
    n = re.sub(r"\(.*?\)|\s", "", name or "")
    return n[:-1] if n.endswith("역") and len(n) > 1 else n


LINE_RE = re.compile(r"(호선|선|라인|line|Line)$")


def station_lines(stations: list[dict]) -> tuple[int, list[str], bool]:
    """같은 역으로 묶인 POI 들의 노선 → (노선 수, 노선 이름, 추정 여부).
    표준데이터(노선명)·OSM line 태그가 있으면 그 이름을 센다. 없으면 OSM 에서 노선마다 따로 찍힌 역 노드 수로
    추정한다(환승역은 보통 노선별 노드가 따로 있다). 둘 다 없으면 1개."""
    names: set[str] = set()
    for p in stations:
        for raw in [p.get("subcategory"), *((p.get("line") or "").split(";"))]:
            v = (raw or "").strip()
            if v and LINE_RE.search(v):
                names.add(v)
    if names:
        return len(names), sorted(names), False
    nodes = {p.get("source_id") for p in stations if p.get("source") == "osm" and str(p.get("source_id", "")).startswith("node/")}
    return max(len(nodes), 1), [], len(nodes) > 1


def best_station(cand: list[dict], walk: float) -> tuple[float, dict | None]:
    """걸어갈 만한(walk 안) 역 중 '노선 가치 × 거리 가중'이 가장 큰 곳(거리 가중: walk×0.4 까지 1 → walk 에서 0)."""
    groups: dict[str, list[dict]] = {}
    for p in cand:
        groups.setdefault(station_key(p["name"]), []).append(p)
    best, info = 0.0, None
    for key, ps in groups.items():
        d = min(p["d"] for p in ps)
        if d > walk:
            continue
        n, lines, guess = station_lines(ps)
        s = LINE_VALUE.get(n, 100.0) * linear(d, walk * 0.4, walk) / 100
        if info is None or s > best:
            best, info = s, {"name": key, "lines": lines, "n_lines": n, "dist_m": int(d), **({"guess": True} if guess else {})}
    return best, info


def dedupe(cand: list[dict]) -> list[dict]:
    """여러 원천(상가정보·심평원·OSM)에 같은 시설이 겹쳐 있으면 한 번만 센다: 이름(공백 제외)과 거리 50m 구간이 같으면 같은 곳."""
    seen: set[tuple[str, int]] = set()
    out = []
    for p in cand:
        k = (re.sub(r"\s", "", p["name"] or ""), int(p["d"] // 50))
        if k[0] and k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out


def _match(p: dict, cats: list[str], subs) -> bool:
    if p["category"] not in cats:
        return False
    if subs is None:
        return True
    sub = p["subcategory"] or ""
    if isinstance(subs, dict):
        if "like" in subs and not any(k in sub for k in subs["like"]):
            return False
        return not ("unlike" in subs and any(k in sub for k in subs["unlike"]))
    return sub in subs


def _subs_list(subs) -> list[str] | None:
    return list(subs) if isinstance(subs, list) else None


def score_point(pois: list[dict], available: set[str], lng: float | None = None, lat: float | None = None
                ) -> tuple[float | None, dict]:
    """→ (총점, 항목별 결과). lng/lat 이 없으면 직주근접은 계산하지 않는다(미수집)."""
    result: dict = {}
    total_w = total = 0.0
    for key, (label, weight, comps) in SPECS.items():
        part_score = part_share = 0.0
        details = []
        for kind, cats, subs, prm, share in comps:
            if kind == "jobs":
                if lng is None or lat is None:
                    continue
                s, det = job_access(lng, lat)
                details.append(det)
                part_score += s * share
                part_share += share
                continue
            if not set(cats) & available:
                continue
            cand = [p for p in pois if _match(p, cats, subs)]
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
                details.append({"type": "near", "cats": cats, "subs": _subs_list(subs), "score": round(s, 1),
                                "name": near and near["name"], "dist_m": near and int(near["d"]),
                                **({"label": prm["label"]} if "label" in prm else {}),
                                **({"area_m2": round(near["area_m2"])} if near and near.get("area_m2") else {})})
            elif kind == "lines":
                s, st = best_station(cand, prm["walk"])
                details.append({"type": "lines", "cats": cats, "score": round(s, 1), "walk": prm["walk"],
                                **(st or {"name": None})})
            elif kind == "count":
                cand = dedupe(cand)
                n = sum(1 for p in cand if p["d"] <= prm["r"])
                eff = sum(decay_weight(p["d"], prm["r"]) for p in cand)
                s = saturate(eff, prm["k"])
                details.append({"type": "count", "cats": cats, "subs": _subs_list(subs), **({"label": prm["label"]} if "label" in prm else {}),
                                "score": round(s, 1), "count": n, "eff": round(eff, 1), "radius": prm["r"], "k": prm["k"]})
            else:
                a = sum(float(p.get("area_1km") or p["area_m2"] or 0) for p in cand if p["d"] <= prm["r"])
                s = saturate(a, prm["k"])
                details.append({"type": "area", "cats": cats, "score": round(s, 1), "area_m2": round(a), "radius": prm["r"]})
            part_score += s * share
            part_share += share
        if not part_share:
            result[key] = {"label": label, "score": None, "status": "미수집"}
            continue
        cat_score = part_score / part_share
        result[key] = {"label": label, "score": round(cat_score, 1), "weight": weight, "details": details}
        total += cat_score * weight
        total_w += weight
    # 시설 자료가 하나도 없으면(직주근접만 있으면) 총점은 비워 둔다 — 한 항목만으로 된 총점은 오해를 부른다
    if not any(v.get("score") is not None for k, v in result.items() if k != "jobs"):
        return None, result
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
    total, scores = score_point(pois, avail, lng, lat)
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
