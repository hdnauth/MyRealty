"""브이월드 NED 속성 조회: 토지특성, 토지이용계획, 개별공시지가, 공동주택가격, 개별주택가격.

응답 형태: {"<복수형키>": {"field": [ {...}, ... ], "totalCount": "n", ...}}
"""

from __future__ import annotations

from .. import http
from ..codes import to_float, to_int
from ..config import settings

BASE = "https://api.vworld.kr/ned/data"


def _fields(data: dict, key: str) -> list[dict]:
    block = data.get(key) or {}
    if isinstance(block, dict) and block.get("resultCode") not in (None, "", "INFO-000", "0"):
        raise RuntimeError(f"VWorld 오류 {block.get('resultCode')}: {block.get('resultMsg')}")
    f = block.get("field") if isinstance(block, dict) else None
    if not f:
        return []
    return f if isinstance(f, list) else [f]


def _get(op: str, key: str, conn=None, **params) -> list[dict]:
    if not settings.vworld_key:
        raise RuntimeError("VWORLD_KEY 미설정")
    http.count_call(conn, f"vworld:{op}")
    q = {"key": settings.vworld_key, "format": "json", "numOfRows": 100, "pageNo": 1, **params}
    if settings.vworld_domain:
        q["domain"] = settings.vworld_domain
    r = http.get(f"{BASE}/{op}", params=q)
    return _fields(r.json(), key)


def parse_land_characteristics(rows: list[dict]) -> dict | None:
    """가장 최근 기준연도의 토지특성."""
    if not rows:
        return None
    r = max(rows, key=lambda x: to_int(x.get("stdrYear")) or 0)
    zones = [z for z in (r.get("prposArea1Nm"), r.get("prposArea2Nm")) if z and z != "지정되지않음"]
    return {
        "jimok": r.get("lndcgrCodeNm"),
        "area_m2": to_float(r.get("lndpclAr")),
        "land_use_zone": zones,
        "land_use_situation": r.get("ladUseSittnNm"),
        "terrain_height": r.get("tpgrphHgCodeNm"),
        "terrain_shape": r.get("tpgrphFrmCodeNm"),
        "road_side": r.get("roadSideCodeNm"),
        "official_price": to_int(r.get("pblntfPclnd")),
        "year": to_int(r.get("stdrYear")),
    }


def parse_land_uses(rows: list[dict]) -> list[dict]:
    """토지이용계획: 지역·지구·구역 목록 (중복 제거)."""
    seen, out = set(), []
    for r in rows:
        name = r.get("prposAreaDstrcCodeNm") or r.get("prposAreaDstrcNm")
        if not name or name in seen:
            continue
        seen.add(name)
        out.append({"name": name, "conflict": r.get("cnflcAtNm")})
    return out


def parse_prices(rows: list[dict], price_key: str) -> list[dict]:
    out = {}
    for r in rows:
        y, p = to_int(r.get("stdrYear")), to_int(r.get(price_key))
        if y and p:
            out[(y, r.get("dongNm"), r.get("hoNm"))] = {
                "year": y, "price": p, "dong": r.get("dongNm"), "ho": r.get("hoNm"), "area_m2": to_float(r.get("prvuseAr")),
            }
    return sorted(out.values(), key=lambda x: x["year"])


_legacy_cache: dict[str, str | None] = {}


def _legacy(pnu: str, conn) -> str | None:
    """개편 지역(전남광주통합특별시 등) 새 코드 PNU 의 옛 코드 PNU. 시군구 이름은 regions 에서 찾는다."""
    from ..codes import LEGACY_SGG_BY_NAME, legacy_pnu

    sgg = pnu[:5]
    if sgg not in _legacy_cache:
        _legacy_cache[sgg] = None
        if conn is not None:
            row = conn.execute(
                "select sido, sigungu from regions where lawd_cd = %s or (substr(lawd_cd, 1, 5) = %s and sido = any(%s)) "
                "order by level limit 1",
                (f"{sgg}00000", sgg, list(LEGACY_SGG_BY_NAME)),
            ).fetchone()
            if row:
                old = legacy_pnu(f"{sgg}{'0' * 14}", row["sido"], row["sigungu"])
                _legacy_cache[sgg] = old[:5] if old else None
    old_sgg = _legacy_cache[sgg]
    return f"{old_sgg}{pnu[5:]}" if old_sgg else None


def _rows(op: str, key: str, conn, pnu: str, **params) -> list[dict]:
    """PNU 로 조회하고, 비어 있으면 옛 코드 PNU 로 한 번 더(행정구역 개편 지역)."""
    rows = _get(op, key, conn, pnu=pnu, **params)
    if not rows:
        old = _legacy(pnu, conn)
        if old:
            rows = _get(op, key, conn, pnu=old, **params)
    return rows


def land_characteristics(pnu: str, conn=None) -> dict | None:
    return parse_land_characteristics(_rows("getLandCharacteristics", "landCharacteristicss", conn, pnu))


def land_uses(pnu: str, conn=None) -> list[dict]:
    return parse_land_uses(_rows("getLandUseAttr", "landUses", conn, pnu))


def land_prices(pnu: str, conn=None) -> list[dict]:
    return parse_prices(_rows("getIndvdLandPriceAttr", "indvdLandPrices", conn, pnu), "pblntfPclnd")


def apt_prices(pnu: str, dong: str | None = None, ho: str | None = None, conn=None) -> list[dict]:
    params = {}
    if dong:
        params["dongNm"] = dong
    if ho:
        params["hoNm"] = ho
    return parse_prices(_rows("getApartHousingPriceAttr", "apartHousingPrices", conn, pnu, **params), "pblntfPc")


def house_prices(pnu: str, conn=None) -> list[dict]:
    return parse_prices(_rows("getIndvdHousingPriceAttr", "indvdHousingPrices", conn, pnu), "housePc")
