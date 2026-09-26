"""국토교통부 건축HUB 건축물대장정보 서비스 (apis.data.go.kr/1613000/BldRgstHubService).

PNU 를 시군구(5)·법정동(5)·대지구분·번·지로 나눠 조회한다. JSON 응답(_type=json).
"""

from __future__ import annotations

from .. import http
from ..codes import parse_pnu, to_float, to_int
from ..config import settings

BASE = "https://apis.data.go.kr/1613000/BldRgstHubService"


def _items(data: dict) -> list[dict]:
    body = (data.get("response") or {}).get("body") or {}
    items = (body.get("items") or {})
    if isinstance(items, str):  # 결과 없음이면 빈 문자열
        return []
    item = items.get("item") if isinstance(items, dict) else None
    if item is None:
        return []
    return item if isinstance(item, list) else [item]


def check_header(data: dict) -> None:
    header = (data.get("response") or {}).get("header") or {}
    code = str(header.get("resultCode", "00"))
    if code not in ("00", "000"):
        raise RuntimeError(f"건축HUB 오류 {code}: {header.get('resultMsg')}")


def _params(pnu: str) -> dict:
    p = parse_pnu(pnu)
    if not p:
        raise ValueError(f"잘못된 PNU: {pnu}")
    return {
        "sigunguCd": p["sgg_cd"],
        "bjdongCd": p["bjdong_cd"],
        "platGbCd": "1" if p["mountain"] else "0",
        "bun": p["bonbun"],
        "ji": p["bubun"],
        "_type": "json",
        "numOfRows": 100,
        "pageNo": 1,
    }


def parse_title(it: dict) -> dict:
    """표제부 1건 → 필요한 필드만."""
    apr = (it.get("useAprDay") or "").strip()
    return {
        "bld_nm": (it.get("bldNm") or "").strip() or None,
        "dong_nm": (it.get("dongNm") or "").strip() or None,
        "main_purpose": it.get("mainPurpsCdNm"),
        "structure": it.get("strctCdNm"),
        "approved_at": f"{apr[:4]}-{apr[4:6]}-{apr[6:8]}" if len(apr) == 8 else None,
        "floors_above": to_int(it.get("grndFlrCnt")),
        "floors_below": to_int(it.get("ugrndFlrCnt")),
        "households": to_int(it.get("hhldCnt")),
        "units": to_int(it.get("hoCnt")),
        "total_area": to_float(it.get("totArea")),
        "plat_area": to_float(it.get("platArea")),
        "bc_rat": to_float(it.get("bcRat")),
        "vl_rat": to_float(it.get("vlRat")),
        "elevators": to_int(it.get("rideUseElvtCnt")),
        "parking": (to_int(it.get("indrAutoUtcnt")) or 0) + (to_int(it.get("oudrAutoUtcnt")) or 0) or None,
    }


def parse_recap(it: dict) -> dict:
    return {
        "bld_nm": (it.get("bldNm") or "").strip() or None,
        "households": to_int(it.get("hhldCnt")),
        "main_buildings": to_int(it.get("mainBldCnt")),
        "total_area": to_float(it.get("totArea")),
        "plat_area": to_float(it.get("platArea")),
        "bc_rat": to_float(it.get("bcRat")),
        "vl_rat": to_float(it.get("vlRat")),
        "parking": to_int(it.get("totPkngCnt")),
    }


def fetch(pnu: str, conn=None) -> dict:
    """{titles: [...], recap: {...}|None}"""
    if not settings.data_go_kr_key:
        raise RuntimeError("DATA_GO_KR_KEY 미설정")
    out: dict = {"titles": [], "recap": None}
    for op, key in (("getBrTitleInfo", "titles"), ("getBrRecapTitleInfo", "recap")):
        http.count_call(conn, f"data.go.kr:BldRgstHubService:{op}", settings.daily_quota_data_go_kr)
        r = http.get(f"{BASE}/{op}", params={"serviceKey": settings.data_go_kr_key, **_params(pnu)})
        data = r.json()
        check_header(data)
        items = _items(data)
        if key == "titles":
            out["titles"] = [parse_title(i) for i in items]
        elif items:
            out["recap"] = parse_recap(items[0])
    return out


def summarize(reg: dict) -> dict:
    """단지 요약: 세대수, 사용승인 연도, 용적률."""
    titles = reg.get("titles") or []
    recap = reg.get("recap") or {}
    hh = recap.get("households") or sum(t.get("households") or 0 for t in titles) or None
    years = [int(t["approved_at"][:4]) for t in titles if t.get("approved_at")]
    return {
        "households": hh,
        "build_year": min(years) if years else None,
        "vl_rat": recap.get("vl_rat") or next((t["vl_rat"] for t in titles if t.get("vl_rat")), None),
        "bc_rat": recap.get("bc_rat") or next((t["bc_rat"] for t in titles if t.get("bc_rat")), None),
    }
