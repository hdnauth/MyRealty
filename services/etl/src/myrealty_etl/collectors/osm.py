"""OpenStreetMap(Overpass API) 주변 시설 — 키가 필요 없는 보조 원천.

소상공인·심평원 API(공공데이터포털)나 표준데이터 CSV 가 없거나 막혔을 때도 지하철·버스·학교·공원·병원·마트·편의점·
음식점·카페를 채워 입지 점수와 지도 레이어가 비지 않게 한다. source='osm', source_id='<type>/<id>'.
"""

from __future__ import annotations

import logging

from .. import http

log = logging.getLogger(__name__)

ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]


def query(lng: float, lat: float, radius: int) -> str:
    near = f"(around:{radius},{lat},{lng})"
    small = f"(around:{min(radius, 700)},{lat},{lng})"
    return f"""[out:json][timeout:40];
(
  nwr["railway"="station"]{near};
  nwr["station"="subway"]{near};
  nwr["amenity"="school"]{near};
  nwr["amenity"="hospital"]{near};
  nwr["amenity"~"^(clinic|doctors)$"]{small};
  nwr["shop"~"^(supermarket|department_store|mall)$"]{near};
  node["highway"="bus_stop"]{small};
  nwr["shop"="convenience"]{small};
  nwr["amenity"~"^(restaurant|fast_food|cafe)$"]{small};
);
out center tags;
(
  way["leisure"="park"]{near};
  relation["leisure"="park"]{near};
  node["leisure"="park"]{near};
);
out geom tags;"""


def classify(tags: dict) -> tuple[str, str | None] | None:
    name = tags.get("name:ko") or tags.get("name") or ""
    if tags.get("railway") == "station" or tags.get("station") == "subway":
        return "subway", tags.get("station") or tags.get("railway")
    if tags.get("amenity") == "school":
        for sub in ("초등학교", "중학교", "고등학교"):
            if name.endswith(sub):
                return "school", sub
        return "school", None
    if tags.get("leisure") == "park":
        return "park", None
    if tags.get("amenity") == "hospital":
        if "대학교" in name or "대학병원" in name:
            return "hospital", "상급종합"
        return "hospital", "종합병원" if "종합병원" in name else "병원"
    if tags.get("amenity") in ("clinic", "doctors"):
        return "clinic", None
    shop = tags.get("shop")
    if shop in ("supermarket", "department_store", "mall"):
        return "mart", shop
    if shop == "convenience":
        return "convenience", None
    if tags.get("highway") == "bus_stop":
        return "bus", None
    if tags.get("amenity") == "cafe":
        return "cafe", None
    if tags.get("amenity") in ("restaurant", "fast_food"):
        return "food", tags.get("cuisine")
    return None


def outline(el: dict) -> list[list[list[float]]] | None:
    """`out geom` 결과의 경계선들([[경도, 위도], …] 목록). 웨이는 한 줄, 멀티폴리곤 릴레이션은 outer·inner 멤버들.
    폴리곤 조립(끊긴 선 잇기·구멍)은 저장할 때 PostGIS ST_BuildArea 가 한다."""
    def line(geom: list[dict] | None) -> list[list[float]] | None:
        pts = [[g["lon"], g["lat"]] for g in (geom or []) if "lon" in g and "lat" in g]
        return pts if len(pts) >= 2 else None

    if el.get("type") == "way":
        ln = line(el.get("geometry"))
        return [ln] if ln and len(ln) >= 4 else None
    if el.get("type") == "relation":
        lines = [ln for m in el.get("members") or [] if m.get("role") in ("outer", "inner", "") and (ln := line(m.get("geometry")))]
        return lines or None
    return None


def parse(data: dict) -> list[dict]:
    out = []
    for el in data.get("elements") or []:
        tags = el.get("tags") or {}
        c = classify(tags)
        if not c:
            continue
        lines = outline(el) if c[0] == "park" else None
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if (lat is None or lng is None) and lines:
            # out geom 에는 center 가 없다 — 경계 점들의 평균(저장할 때 영역 안쪽 점으로 바뀐다)
            pts = [p for ln in lines for p in ln]
            lng, lat = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        if lat is None or lng is None:
            continue
        name = tags.get("name:ko") or tags.get("name") or {"bus": "버스정류장", "park": "공원"}.get(c[0], "")
        if not name:
            continue
        out.append({"source": "osm", "source_id": f"{el['type']}/{el['id']}", "category": c[0], "subcategory": c[1],
                    "name": name[:200], "lng": float(lng), "lat": float(lat), "area_m2": None,
                    "attrs": {k: tags[k] for k in ("operator", "line", "network") if k in tags},
                    **({"lines": lines} if lines else {})})
    return out


def fetch(lng: float, lat: float, radius: int = 2000) -> list[dict]:
    q = query(lng, lat, radius)
    last: Exception | None = None
    for url in ENDPOINTS:
        try:
            r = http.client().post(url, data={"data": q}, timeout=60)
            r.raise_for_status()
            return parse(r.json())
        except Exception as e:  # 다음 미러
            last = e
            log.warning("Overpass %s 실패: %s", url, e)
    raise last or RuntimeError("Overpass 실패")
