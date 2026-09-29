"""생활편의 POI 수집.

- 소상공인시장진흥공단 상가(상권)정보: 반경 내 음식점·카페·학원·의원·편의점·마트 등
- 건강보험심사평가원 병원정보서비스: 상급종합·종합병원·병원(좌표 포함)
- 공공데이터포털 표준데이터 CSV(지하철역·버스정류장·학교·도시공원·대규모점포): import_csv
"""

from __future__ import annotations

import csv
import io
import json
import logging
from pathlib import Path

from .. import http
from ..codes import to_float
from ..config import settings
from ..db import jsonb

log = logging.getLogger(__name__)

SEMAS_URL = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius"
HIRA_URL = "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList"


def classify_store(l_nm: str, m_nm: str, s_nm: str) -> tuple[str, str] | None:
    """상가업소 업종(대·중·소분류명) → (category, subcategory). 관심 없는 업종은 None."""
    lg, m, s = l_nm or "", m_nm or "", s_nm or ""
    ms = f"{m} {s}"
    if "음식" in lg:
        if any(k in ms for k in ("커피", "카페", "비알코올", "제과", "디저트", "아이스크림")):
            return "cafe", s or m
        return "food", m or s
    if "교육" in lg or "학문" in lg:
        if "학원" in ms or "교습" in ms or "교육" in m:
            return "academy", s or m
        return None
    if "보건" in lg or "의료" in lg:
        if "약국" in ms:
            return "pharmacy", s
        return "clinic", s or m
    if "소매" in lg:
        if "편의점" in ms:
            return "convenience", "편의점"
        if any(k in ms for k in ("대형마트", "백화점", "슈퍼마켓", "할인점", "대형 할인")):
            return "mart", s or m
        return None
    return None


def parse_semas(data: dict) -> list[dict]:
    header = data.get("header") or {}
    if str(header.get("resultCode", "00")) not in ("00", "03"):  # 03 = 데이터 없음
        raise RuntimeError(f"상가정보 오류 {header.get('resultCode')}: {header.get('resultMsg')}")
    out = []
    for it in (data.get("body") or {}).get("items") or []:
        cat = classify_store(it.get("indsLclsNm"), it.get("indsMclsNm"), it.get("indsSclsNm"))
        lng, lat = to_float(it.get("lon")), to_float(it.get("lat"))
        if not cat or lng is None or lat is None:
            continue
        out.append({"source": "semas", "source_id": str(it.get("bizesId")), "category": cat[0], "subcategory": cat[1],
                    "name": (it.get("bizesNm") or "").strip() + (f" {it['brchNm']}" if it.get("brchNm") else ""),
                    "lng": lng, "lat": lat, "area_m2": None, "attrs": {"addr": it.get("rdnmAdr")}})
    return out


def classify_hospital(cl_nm: str) -> tuple[str, str]:
    if cl_nm in ("상급종합", "상급종합병원", "종합병원"):
        return "hospital", cl_nm
    if "병원" in cl_nm and "의원" not in cl_nm:
        return "hospital", cl_nm
    return "clinic", cl_nm


def parse_hira(data: dict) -> list[dict]:
    body = (data.get("response") or {}).get("body") or {}
    items = body.get("items") or {}
    item = items.get("item") if isinstance(items, dict) else None
    rows = item if isinstance(item, list) else ([item] if item else [])
    out = []
    for it in rows:
        lng, lat = to_float(it.get("XPos")), to_float(it.get("YPos"))
        if lng is None or lat is None:
            continue
        cat, sub = classify_hospital(it.get("clCdNm") or "")
        out.append({"source": "hira", "source_id": str(it.get("ykiho")), "category": cat, "subcategory": sub,
                    "name": it.get("yadmNm") or "", "lng": lng, "lat": lat, "area_m2": None,
                    "attrs": {"addr": it.get("addr"), "doctors": it.get("drTotCnt")}})
    return out


def upsert_pois(conn, rows: list[dict]) -> int:
    plain = [r for r in rows if not r.get("lines")]
    shaped = [r for r in rows if r.get("lines")]
    with conn.cursor() as cur:
        if plain:
            cur.executemany(
                """insert into pois (source, source_id, category, subcategory, name, geom, area_m2, attrs, updated_at)
                   values (%(source)s, %(source_id)s, %(category)s, %(subcategory)s, %(name)s,
                     ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326), %(area_m2)s, %(attrs_j)s, now())
                   on conflict (source, source_id) do update set category = excluded.category, subcategory = excluded.subcategory,
                     name = excluded.name, geom = excluded.geom, area_m2 = excluded.area_m2, attrs = excluded.attrs, updated_at = now()""",
                [{**r, "attrs_j": jsonb(r.get("attrs") or {})} for r in plain],
            )
        if shaped:
            # 경계선 → 폴리곤(끊긴 멤버 잇기·구멍 처리). 조립이 안 되면(열린 선만) 점으로만 저장된다
            cur.executemany(
                """with g as (
                     select ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_BuildArea(
                              ST_SetSRID(ST_GeomFromGeoJSON(%(lines_j)s::text), 4326))), 3)) as shape
                   )
                   insert into pois (source, source_id, category, subcategory, name, geom, shape, area_m2, attrs, updated_at)
                   select %(source)s, %(source_id)s, %(category)s, %(subcategory)s, %(name)s,
                     case when ST_IsEmpty(shape) or shape is null then ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)
                          else ST_PointOnSurface(shape) end,
                     nullif(shape, ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)),
                     case when shape is null or ST_IsEmpty(shape) then null else round(ST_Area(shape::geography)) end,
                     %(attrs_j)s, now()
                   from g
                   on conflict (source, source_id) do update set category = excluded.category, subcategory = excluded.subcategory,
                     name = excluded.name, geom = excluded.geom, shape = excluded.shape, area_m2 = excluded.area_m2,
                     attrs = excluded.attrs, updated_at = now()""",
                [{**r, "attrs_j": jsonb(r.get("attrs") or {}),
                  "lines_j": json.dumps({"type": "MultiLineString", "coordinates": r["lines"]})} for r in shaped],
            )
    return len(rows)


def fetch_semas(lng: float, lat: float, radius: int = 1000, conn=None) -> list[dict]:
    out, page = [], 1
    while True:
        http.count_call(conn, "data.go.kr:semas", settings.daily_quota_data_go_kr)
        r = http.get(SEMAS_URL, params={"serviceKey": settings.data_go_kr_key, "pageNo": page, "numOfRows": 1000,
                                        "radius": radius, "cx": lng, "cy": lat, "type": "json"})
        data = r.json()
        out.extend(parse_semas(data))
        total = int((data.get("body") or {}).get("totalCount") or 0)
        if page * 1000 >= total or page >= 10:
            break
        page += 1
    return out


def fetch_hira(lng: float, lat: float, radius: int = 5000, conn=None) -> list[dict]:
    out = []
    for cl in ("01", "11", "21"):  # 상급종합, 종합병원, 병원
        http.count_call(conn, "data.go.kr:hira", settings.daily_quota_data_go_kr)
        r = http.get(HIRA_URL, params={"serviceKey": settings.data_go_kr_key, "pageNo": 1, "numOfRows": 500,
                                       "xPos": lng, "yPos": lat, "radius": radius, "clCd": cl, "_type": "json"})
        out.extend(parse_hira(r.json()))
    return out


# ── 표준데이터 CSV ────────────────────────────────────────────────
NAME_COLS = ["역사명", "정류장명", "학교명", "공원명", "사업장명", "시설명", "명칭", "name"]
LAT_COLS = ["역위도", "위도", "lat", "latitude", "y"]
LNG_COLS = ["역경도", "경도", "lon", "lng", "longitude", "x"]
TM_X_COLS = ["좌표정보(x)", "좌표정보x(epsg5174)", "좌표정보x", "x좌표"]
TM_Y_COLS = ["좌표정보(y)", "좌표정보y(epsg5174)", "좌표정보y", "y좌표"]
SUB_COLS = ["학교급구분", "공원구분", "노선명", "업태구분명", "개방서비스명"]
AREA_COLS = ["공원면적", "면적"]
ID_COLS = ["역사_id", "역번호", "정류장번호", "학교id", "관리번호", "공원번호"]
CATEGORY_BY_SUB = {"초등학교": "school", "중학교": "school", "고등학교": "school"}


def _pick(header: list[str], candidates: list[str]) -> str | None:
    low = {h.lower().replace(" ", ""): h for h in header}
    for c in candidates:
        if c.lower().replace(" ", "") in low:
            return low[c.lower().replace(" ", "")]
    return None


def read_csv_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("CSV 인코딩을 알 수 없습니다(UTF-8/CP949)")


def parse_csv(text: str, category: str, dataset: str) -> tuple[list[dict], list[dict]]:
    """→ (위경도 행, TM 좌표 행). TM 행은 DB 에서 ST_Transform 한다."""
    reader = csv.DictReader(io.StringIO(text))
    header = reader.fieldnames or []
    name_c, lat_c, lng_c = _pick(header, NAME_COLS), _pick(header, LAT_COLS), _pick(header, LNG_COLS)
    tx_c, ty_c = _pick(header, TM_X_COLS), _pick(header, TM_Y_COLS)
    sub_c, area_c, id_c = _pick(header, SUB_COLS), _pick(header, AREA_COLS), _pick(header, ID_COLS)
    if not name_c or not ((lat_c and lng_c) or (tx_c and ty_c)):
        raise ValueError(f"이름/좌표 열을 찾지 못했습니다. 헤더: {header[:15]}")
    wgs, tm = [], []
    for i, row in enumerate(reader):
        name = (row.get(name_c) or "").strip()
        if not name:
            continue
        sub = (row.get(sub_c) or "").strip() if sub_c else None
        cat = CATEGORY_BY_SUB.get(sub or "", category) if category == "school" else category
        rec = {"source": f"csv:{dataset}", "source_id": (row.get(id_c) or "").strip() if id_c else f"{name}:{i}",
               "category": cat, "subcategory": sub or None, "name": name,
               "area_m2": to_float(row.get(area_c)) if area_c else None, "attrs": {}}
        if not rec["source_id"]:
            rec["source_id"] = f"{name}:{i}"
        lat, lng = (to_float(row.get(lat_c)), to_float(row.get(lng_c))) if lat_c and lng_c else (None, None)
        if lat and lng and 33 < lat < 39 and 124 < lng < 132:
            wgs.append({**rec, "lng": lng, "lat": lat})
        elif tx_c and ty_c and to_float(row.get(tx_c)) and to_float(row.get(ty_c)):
            tm.append({**rec, "x": to_float(row.get(tx_c)), "y": to_float(row.get(ty_c))})
    return wgs, tm


def import_csv(conn, path: str, category: str, dataset: str | None = None, srid: int = 5174) -> dict:
    p = Path(path)
    wgs, tm = parse_csv(read_csv_text(p), category, dataset or p.stem)
    n = upsert_pois(conn, wgs)
    with conn.cursor() as cur:
        cur.executemany(
            """insert into pois (source, source_id, category, subcategory, name, geom, area_m2, attrs, updated_at)
               values (%(source)s, %(source_id)s, %(category)s, %(subcategory)s, %(name)s,
                 ST_Transform(ST_SetSRID(ST_MakePoint(%(x)s, %(y)s), %(srid)s), 4326), %(area_m2)s, '{}', now())
               on conflict (source, source_id) do update set geom = excluded.geom, name = excluded.name, updated_at = now()""",
            [{**r, "srid": srid} for r in tm],
        )
    conn.commit()
    return {"wgs84": n, "tm": len(tm)}
