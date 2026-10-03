"""정비구역 수집 공통: 단계·유형 정규화, 이름 키, 위치 찾기(지오코딩·브이월드 검색), 저장(단계 변경 이력).

출처마다 표기가 다르다(서울 정보몽땅·경기·부산·인천·대전·국토부 전국 통합). 각 수집기는 아래 형태의 레코드를 만들고
upsert_record 로 저장한다:
  {source, source_id, sido, sgg_name, name, full_name?, kind, stage, stage_date?, address?, lng?, lat?,
   households_plan?, households_now?, area_m2?, url?, sgg_cd?, attrs?}
"""

from __future__ import annotations

import logging
import os
import re
from datetime import date

import httpx

from .. import http
from ..config import settings
from ..db import jsonb

log = logging.getLogger(__name__)

VWORLD_SEARCH = "https://api.vworld.kr/req/search"
VWORLD_DATA = "https://api.vworld.kr/req/data"

# 진행단계 자유 표기 → 9단계 진행도(기본계획 1 … 준공·해산 9). 앞에서부터 처음 맞는 규칙을 쓴다.
STAGE_RULES: list[tuple[str, int]] = [
    ("후보지", 1), ("행위제한", 1),  # 토지이용계획의 정비사업 후보지·행위제한(구역 지정 전, landuse_zones)
    ("지정전", 1),  # 경기 '정비구역지정 전' — 지정 이전 단계(아래 '구역지정'보다 먼저)
    ("해산", 9), ("청산", 9), ("이전고시", 9), ("준공", 9), ("해제", 9), ("취소", 9),
    ("착공", 8), ("분양", 8),
    ("철거", 7), ("이주", 7),
    ("관리처분", 6),
    ("시행자지정", 4),  # 공공·신탁 방식의 '사업시행자지정'은 조합설립에 해당(사업시행인가보다 먼저 확인)
    ("사업시행", 5), ("사업계획승인", 5),
    ("조합설", 4), ("건축심의", 4), ("통합심의", 4),
    ("추진위", 3), ("창립총회", 3), ("규약", 3), ("합의체", 3),
    ("예정구역", 1),
    ("구역지정", 2), ("정비구역", 2),
    ("정비계획", 1), ("안전진단", 1), ("진단", 1), ("심의", 1), ("모집", 1), ("기본계획", 1),
    ("구성전", 1), ("구성 전", 1),
    ("조합", 4),  # 경기 "조합(시행자)" 같은 묶음 표기
]


def stage_order(stage: str | None) -> int | None:
    s = re.sub(r"^\d+\)", "", (stage or "").replace(" ", ""))
    if not s:
        return None
    return next((o for key, o in STAGE_RULES if key.replace(" ", "") in s), None)


_DATE = re.compile(r"(\d{4}|\d{2})[-.](\d{1,2})[-.](\d{1,2})")


def clean_stage(stage: str | None) -> str | None:
    """'6)관리처분인가' → '관리처분인가', '준공(2022-04-28)' → '준공', '조합설립(21-01-26)' → '조합설립'."""
    s = re.sub(r"^\s*\d+\)", "", stage or "")
    s = re.sub(r"\(\s*(\d{4}|\d{2})[-.]\d{1,2}[-.]\d{1,2}\s*\)", "", s)
    return " ".join(s.split()) or None


def stage_date(stage: str | None) -> str | None:
    m = _DATE.search(stage or "")
    if not m:
        return None
    y = int(m.group(1)) + (2000 if len(m.group(1)) == 2 else 0)
    mo, d = int(m.group(2)), int(m.group(3))
    return f"{y}-{mo:02d}-{d:02d}" if 1 <= mo <= 12 and 1 <= d <= 31 else None


# 유형 표기 → 화면 유형. 부분 문자열 규칙(앞에서부터).
KIND_RULES: list[tuple[str, str]] = [
    ("도시정비", "도시정비형재개발"), ("도시환경", "도시정비형재개발"),
    ("소규모재건축", "소규모재건축"), ("소규모재개발", "소규모재개발"), ("소규모주택", "가로주택"), ("가로주택", "가로주택"),
    ("주거환경개선", "주거환경개선"), ("리모델링", "리모델링"), ("지역주택", "지역주택조합"), ("재정비촉진", "재개발"),
    ("재건축", "재건축"), ("재개발", "재개발"),
]


def normalize_kind(raw: str | None, name: str | None = None) -> str:
    for text in (raw, name):
        s = re.sub(r"^\d+\)", "", (text or "").replace(" ", ""))
        hit = next((k for key, k in KIND_RULES if key in s), None)
        if hit:
            return hit
    return "기타"


_NAME_CUT = re.compile(r"\s*(소규모주택|(민간\s*)?(도시\s*정비형\s*|주택\s*정비형\s*|주택\s*)?(소규모\s*)?(재건축|재개발|가로주택|리모델링|도시환경))")
_NAME_TAIL = re.compile(r"(\s*(\(뉴타운\)|정비사업|사업|(?<!지역주택)조합|추진위원회|설립|정비))+\s*$")


def short_name(name: str) -> str:
    """'개포주공5단지아파트 재건축정비사업 조합' → '개포주공5단지아파트' (지도 라벨·목록용)."""
    s = re.sub(r"^\s*(\(가칭\)|\d+\.)\s*", "", name)
    m = _NAME_CUT.search(s)
    if m and m.start() > 0:
        s = s[:m.start()]
    s = _NAME_TAIL.sub("", s).strip()
    return s or name


_KEY_DROP = re.compile(r"\(가칭\)|\(.*?\)|재정비촉진|정비|재개발|재건축|주택|사업|조합|구역|지구|아파트|단지|일원|일대|번지|제|[\s\-_·.,/'\"]")


def name_key(name: str | None) -> str:
    """출처 간 같은 구역 찾기용 키: '북변3구역 재개발' ≈ '북변3', '장대B' ≈ '장대B구역'."""
    return _KEY_DROP.sub("", short_name(name or "")).lower()


def sgg_key(name: str | None) -> str:
    """'수원시 권선구' ≈ '수원권선구', '안산시 단원구' ≈ '안산단원구'."""
    s = re.sub(r"\s+", "", name or "")
    return re.sub(r"시(?=.+[구군]$)", "", s)


# 시도 이름 → 시군구 코드 앞 두 자리(개편 전·후 코드 모두)
SIDO_PREFIX: dict[str, list[str]] = {
    "서울": ["11"], "부산": ["26"], "대구": ["27"], "인천": ["28"], "광주": ["29", "12"], "대전": ["30"], "울산": ["31"],
    "세종": ["36"], "경기": ["41"], "강원": ["42", "51"], "충청북": ["43"], "충북": ["43"], "충청남": ["44"], "충남": ["44"],
    "전라북": ["45", "52"], "전북": ["45", "52"], "전라남": ["46", "12"], "전남": ["46", "12", "29"], "경상북": ["47"], "경북": ["47"],
    "경상남": ["48"], "경남": ["48"], "제주": ["50"],
}


def sido_prefixes(sido: str | None) -> list[str]:
    s = sido or ""
    return next((v for k, v in SIDO_PREFIX.items() if s.startswith(k) or (k == "광주" and "광주" in s)), [])


# ───── 브이월드 검색 ─────

def _vworld_params(**p) -> dict:
    p.update({"key": settings.vworld_key, "format": "json", "crs": "EPSG:4326"})
    if settings.vworld_domain:
        p["domain"] = settings.vworld_domain
    return p


def vworld_search(query: str, kind: str = "place", category: str | None = None, size: int = 10) -> list[dict]:
    if not settings.vworld_key:
        return []
    params = _vworld_params(service="search", request="search", version="2.0", query=query, type=kind, size=str(size))
    if category:
        params["category"] = category
    resp = http.get(VWORLD_SEARCH, params=params).json().get("response", {})
    if resp.get("status") != "OK":
        return []
    out = []
    for it in (resp.get("result") or {}).get("items", []):
        try:
            addr = it.get("address") or {}
            out.append({"id": it.get("id"), "title": it.get("title") or "", "category": it.get("category") or "",
                        "address": addr.get("road") or addr.get("parcel") or it.get("title") or "",
                        "lng": float(it["point"]["x"]), "lat": float(it["point"]["y"])})
        except (KeyError, TypeError, ValueError):
            continue
    return out


def sgg_info_of_point(lng: float, lat: float) -> dict | None:
    """좌표 → {sig_cd, full_nm('경기도 수원시 팔달구')} (브이월드 행정구역). 실패하면 None."""
    if not settings.vworld_key:
        return None
    params = _vworld_params(service="data", request="GetFeature", data="LT_C_ADSIGG_INFO",
                            geomFilter=f"POINT({lng} {lat})", geometry="false", attribute="true", size="1")
    try:
        resp = http.get(VWORLD_DATA, params=params).json().get("response", {})
    except (httpx.HTTPError, ValueError) as e:
        log.warning("시군구 조회 실패: %s", e)
        return None
    feats = ((resp.get("result") or {}).get("featureCollection") or {}).get("features") or []
    return feats[0]["properties"] if feats else None


def sgg_of_point(lng: float, lat: float) -> str | None:
    """좌표 → 시군구 코드(브이월드 행정구역). 실패하면 None."""
    info = sgg_info_of_point(lng, lat)
    return info.get("sig_cd") if info else None


def in_region(address: str, sido: str | None, sgg_name: str | None) -> bool:
    """검색 결과 주소가 그 구역의 시도·시군구 안인지. 시군구를 알면 시군구까지 맞아야 한다
    (예전에는 시도만 맞아도 받아 안양 벽산아파트가 수원 팔달구 같은 이름 단지에, 안산 인정프린스가 수원 권선구에 찍혔다)."""
    addr = sgg_key(address)
    sido2 = (sido or "")[:2]
    if sido2 and sido2 not in address:
        return False
    token = sgg_key(sgg_name)[-3:]
    return token in addr if token else bool(sido2)


def _dong_of(name: str) -> str | None:
    """구역명에서 동 이름 추정: '북변3' → '북변동', '속초중앙동' → '중앙동', '원동다박골' → '원동'."""
    m = re.match(r"^([가-힣]+?)(동|읍|면|리)", name)
    if m and len(m.group(1)) >= 1:
        base = m.group(1)
        # '속초중앙동'처럼 시군 이름이 앞에 붙은 경우는 뒤의 두 글자 + 동
        return (base[-2:] if len(base) > 3 else base) + m.group(2)
    m = re.match(r"^([가-힣]{1,4}?)\d", name)
    return f"{m.group(1)}동" if m else None


def locate(conn, rec: dict) -> tuple[float, float, str] | None:
    """주소가 없거나 지오코딩이 안 될 때 구역 위치 찾기. 반환: (경도, 위도, 정밀도)
    정밀도: address(지번) · complex(같은 이름 단지) · place(브이월드 장소) · dong(법정동 중심, 대략)."""
    from ..transforms.geocode import geocode

    if rec.get("address"):
        q = rec["address"]
        if rec.get("sido") and rec["sido"][:2] not in q:
            sgg = rec.get("sgg_name") or ""
            q = f"{rec['sido']} {q}" if not sgg or sgg.split()[-1] in q else f"{rec['sido']} {sgg} {q}"
        pt = geocode(conn, re.sub(r"(번지)?\s*(일원|일대|외\s*\d*\s*필지).*$", "", q))
        if pt:
            return pt[0], pt[1], "address"
    short = short_name(rec["name"])
    sgg_token = sgg_key(rec.get("sgg_name"))[-3:]
    # 같은 이름 단지(재건축은 대개 단지 이름이 구역 이름)
    if rec.get("kind") in ("재건축", "소규모재건축", "리모델링"):
        from ..codes import normalize_name

        prefixes = sido_prefixes(rec.get("sido"))
        row = conn.execute(
            """select ST_X(c.geom) as lng, ST_Y(c.geom) as lat from complexes c
               where c.geom is not null and c.name_norm = %s and left(c.sgg_cd, 2) = any(%s) limit 1""",
            (normalize_name(short), prefixes),
        ).fetchone() if prefixes else None
        if row:
            # 같은 이름 단지가 같은 시도 다른 시에 있을 수 있다 — 시군구까지 맞을 때만
            info = sgg_info_of_point(row["lng"], row["lat"]) if rec.get("sgg_name") else None
            if not rec.get("sgg_name") or (info and in_region(info.get("full_nm") or "", rec.get("sido"), rec.get("sgg_name"))):
                return row["lng"], row["lat"], "complex"
    try:
        for q in (short, f"{short}구역" if not short.endswith("구역") else None):
            if not q:
                continue
            for p in vworld_search(q):
                if in_region(p["address"], rec.get("sido"), rec.get("sgg_name")) and ("아파트" in p["category"] or "주거" in p["category"] or "구역" in p["title"] or q in p["title"]):
                    return p["lng"], p["lat"], "place"
        dong = _dong_of(short)
        if dong:
            for d in vworld_search(dong, kind="district", category="L4", size=30):
                if sgg_token and sgg_token in sgg_key(d["title"]) or (not sgg_token and (rec.get("sido") or "")[:2] in d["title"]):
                    return d["lng"], d["lat"], "dong"
    except (httpx.HTTPError, ValueError) as e:
        log.warning("구역 위치 검색 실패 %s: %s", rec["name"], e)
    return None


def verify_locations(conn, limit: int = 300) -> dict:
    """이름 검색으로 찾은 위치(place·complex)가 구역의 시군구 안인지 한 번 확인한다. 다른 시군구면 좌표를 지워
    locate 단계가 고친 규칙으로 다시 찾게 한다(예전 규칙은 시도만 맞아도 받아 다른 시에 찍힌 곳이 있었다)."""
    stats = {"checked": 0, "cleared": 0}
    rows = conn.execute(
        """select id, attrs->>'sido' as sido, attrs->>'gu' as gu, ST_X(ST_PointOnSurface(geom)) as lng, ST_Y(ST_PointOnSurface(geom)) as lat
           from redevelopment_zones
           where geom is not null and attrs->>'geo' in ('place', 'complex') and attrs->>'gu' is not null
             and not coalesce((attrs->>'geo_verified')::boolean, false)
           order by id limit %s""",
        (limit,),
    ).fetchall()
    for r in rows:
        info = sgg_info_of_point(r["lng"], r["lat"])
        if not info:
            continue
        stats["checked"] += 1
        if in_region(info.get("full_nm") or "", r["sido"], r["gu"]):
            conn.execute("update redevelopment_zones set attrs = attrs || '{\"geo_verified\": true}'::jsonb where id = %s", (r["id"],))
        else:
            conn.execute(
                """update redevelopment_zones set geom = null, sgg_cd = null,
                     attrs = (attrs - 'geo' - 'geo_tried' - 'pt') || jsonb_build_object('geo_wrong', %s::text), updated_at = now()
                   where id = %s""",
                (info.get("full_nm"), r["id"]),
            )
            stats["cleared"] += 1
    conn.commit()
    return stats


def locate_pending(conn, limit: int | None = None) -> dict:
    """좌표 없는 구역 이어서 찾기 — 출처를 다시 받지 않는다. 한 실행 상한(LOCATE_BUDGET)에 걸렸거나 30일 전에 못 찾은 곳.
    수집 지역(collect_targets) 시군구·진행 중 구역부터."""
    budget = LOCATE_BUDGET["left"] if limit is None else limit
    stats = {"pending": 0, "located": 0, "missed": 0}
    if budget <= 0:
        return stats
    rows = conn.execute(
        """select id, name, kind, address, attrs->>'sido' as sido, attrs->>'gu' as gu, sgg_cd
           from redevelopment_zones
           where geom is null and not coalesce((attrs->>'geo_tried')::date > current_date - 30, false)
           order by (sgg_cd in (select sgg_cd from collect_targets)) desc nulls last, stage_order = 9, address is null, id
           limit %s""",
        (budget,),
    ).fetchall()
    stats["pending"] = len(rows)
    for i, r in enumerate(rows):
        LOCATE_BUDGET["left"] -= 1
        pt = locate(conn, {"name": r["name"], "kind": r["kind"], "address": r["address"], "sido": r["sido"], "sgg_name": r["gu"]})
        if pt:
            sgg = r["sgg_cd"] or sgg_of_point(pt[0], pt[1])
            conn.execute(
                """update redevelopment_zones set geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326), sgg_cd = coalesce(sgg_cd, %s),
                     attrs = attrs || jsonb_build_object('geo', %s::text) - 'geo_tried', updated_at = now() where id = %s""",
                (pt[0], pt[1], sgg, pt[2], r["id"]),
            )
            stats["located"] += 1
        else:
            conn.execute(
                "update redevelopment_zones set attrs = attrs || jsonb_build_object('geo_tried', current_date::text) where id = %s", (r["id"],)
            )
            stats["missed"] += 1
        if i % 50 == 49:
            conn.commit()
    conn.commit()
    return stats


# ───── 저장 ─────

# 한 번 실행에서 새로 위치를 찾는 횟수 상한(첫 수집 때 수천 건 지오코딩·검색으로 매일 작업 시간을 넘기지 않게).
# 다 쓰면 나머지는 좌표 없이 저장하고 다음 실행에서 이어서 찾는다.
LOCATE_BUDGET = {"left": int(os.environ.get("ZONES_LOCATE_BUDGET") or 900)}

def dedupe_id(seen: dict[str, int], rec: dict) -> dict:
    """한 출처 목록에 같은 키(시군구·이름)가 두 번 나오면 두 번째부터 '#2'를 붙인다 — 서로 덮어쓰며 가짜 단계 변경을
    만들지 않도록. 목록 순서가 같으면 다음 실행에서도 같은 키가 된다."""
    k = f"{rec['source']}:{rec['source_id']}"
    seen[k] = seen.get(k, 0) + 1
    if seen[k] > 1:
        rec["source_id"] = f"{rec['source_id']}#{seen[k]}"
    return rec


def upsert_record(conn, rec: dict, *, find_location: bool = True) -> str:
    """정비구역 한 곳 반영. 반환: 'new' | 'changed' | 'same'. 단계가 바뀌면 zone_stage_history 에 남긴다."""
    key = f"{rec['source']}:{rec['source_id']}"
    stage = clean_stage(rec.get("stage"))
    order = stage_order(rec.get("stage"))
    prev = conn.execute(
        """select id, stage, stage_order, address, geom is not null as has_geom, sgg_cd,
             coalesce((attrs->>'geo_tried')::date > current_date - 30, false) as tried_recently
           from redevelopment_zones where source_key = %s""",
        (key,),
    ).fetchone()
    pt = None
    tried = False
    address_changed = bool(prev and rec.get("address") and prev["address"] != rec.get("address"))
    if rec.get("lng") is not None and rec.get("lat") is not None:
        pt = (rec["lng"], rec["lat"], rec.get("geo") or "source")
    elif (find_location and LOCATE_BUDGET["left"] > 0
          and (not prev or address_changed or (not prev["has_geom"] and not prev["tried_recently"]))):
        LOCATE_BUDGET["left"] -= 1
        pt = locate(conn, rec)
        tried = pt is None  # 못 찾은 곳은 30일 동안 다시 찾지 않는다(매일 검색 호출 낭비 방지)
    sgg_cd = rec.get("sgg_cd") or (prev and prev["sgg_cd"])
    if not sgg_cd and pt:
        sgg_cd = sgg_of_point(pt[0], pt[1])
    attrs = {"source": rec["source"], "sido": rec.get("sido"), "gu": rec.get("sgg_name"), "kind_raw": rec.get("kind_raw"),
             "full_name": rec.get("full_name") or rec["name"], "url": rec.get("url"), **(rec.get("attrs") or {})}
    if pt:
        attrs["geo"] = pt[2]
    if tried:
        attrs["geo_tried"] = date.today().isoformat()
    if rec.get("stage_date") or stage_date(rec.get("stage")):
        attrs["stage_dated"] = True  # 출처가 준 단계 날짜(단계 효과 분석에 쓴다)
    if order == 9 and "해제" in (stage or ""):
        attrs["canceled"] = True
    zone = conn.execute(
        """insert into redevelopment_zones (source_key, name, kind, stage, stage_order, stage_date, households_now, households_plan,
             area_m2, address, sgg_cd, geom, attrs, updated_at)
           values (%(key)s, %(name)s, %(kind)s, %(stage)s, %(order)s, %(stage_date)s, %(hh_now)s, %(hh_plan)s, %(area)s,
             %(address)s, %(sgg)s,
             case when %(lng)s::float8 is null then null else ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326) end, %(attrs)s, now())
           on conflict (source_key) do update set name = excluded.name, kind = excluded.kind, stage = excluded.stage,
             stage_order = excluded.stage_order, address = coalesce(excluded.address, redevelopment_zones.address),
             sgg_cd = coalesce(excluded.sgg_cd, redevelopment_zones.sgg_cd),
             households_now = coalesce(excluded.households_now, redevelopment_zones.households_now),
             households_plan = coalesce(excluded.households_plan, redevelopment_zones.households_plan),
             area_m2 = coalesce(redevelopment_zones.area_m2, excluded.area_m2),
             -- 경계(폴리곤)를 이미 붙였으면 점으로 덮지 않는다
             geom = case when redevelopment_zones.geom is not null and GeometryType(redevelopment_zones.geom) like '%%POLYGON'
                         then redevelopment_zones.geom else coalesce(excluded.geom, redevelopment_zones.geom) end,
             stage_date = coalesce(excluded.stage_date, case when redevelopment_zones.stage is distinct from excluded.stage
                               then current_date else redevelopment_zones.stage_date end),
             attrs = redevelopment_zones.attrs || excluded.attrs, updated_at = now()
           returning id""",
        {"key": key, "name": short_name(rec["name"]), "kind": rec.get("kind") or normalize_kind(rec.get("kind_raw"), rec["name"]),
         "stage": stage, "order": order, "stage_date": rec.get("stage_date") or stage_date(rec.get("stage")),
         "hh_now": rec.get("households_now"), "hh_plan": rec.get("households_plan"), "area": rec.get("area_m2"),
         "address": rec.get("address"), "sgg": sgg_cd, "lng": pt[0] if pt else None, "lat": pt[1] if pt else None,
         "attrs": jsonb({k: v for k, v in attrs.items() if v is not None})},
    ).fetchone()
    if not prev:
        return "new"
    if prev["stage"] == stage:
        return "same"
    conn.execute(
        """insert into zone_stage_history (zone_id, stage, stage_order, prev_stage, prev_order)
           values (%s, %s, %s, %s, %s)""",
        (zone["id"], stage, order, prev["stage"], prev["stage_order"]),
    )
    return "changed"
