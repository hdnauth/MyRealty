"""한국부동산원 청약홈 분양정보 조회 서비스 (api.odcloud.kr, 공공데이터포털 키 사용)."""

from __future__ import annotations

from datetime import date

from .. import http
from ..config import settings

URL = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail"
# 주택형별 분양가(최고가) — 공고 1건당 한 번 조회
MODEL_URL = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl"


def _d(s: str | None) -> date | None:
    if not s:
        return None
    s = s.strip().replace(".", "-")
    try:
        if len(s) == 8 and s.isdigit():
            return date(int(s[:4]), int(s[4:6]), int(s[6:]))
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _ym(s: str | None) -> date | None:
    """'202812' → 2028-12-01"""
    if not s or len(s.strip()) < 6:
        return None
    s = s.strip().replace("-", "")
    try:
        return date(int(s[:4]), int(s[4:6]), 1)
    except ValueError:
        return None


def parse(row: dict) -> list[dict]:
    """공고 1건 → events 행들(청약 접수, 입주 예정)."""
    key = f"{row.get('HOUSE_MANAGE_NO')}:{row.get('PBLANC_NO')}"
    name = (row.get("HOUSE_NM") or "").strip()
    addr = (row.get("HSSPLY_ADRES") or "").strip()
    payload = {
        "house_type": row.get("HOUSE_SECD_NM"),
        "households": row.get("TOT_SUPLY_HSHLDCO"),
        "announce_date": row.get("RCRIT_PBLANC_DE"),
        "winner_date": row.get("PRZWNER_PRESNATN_DE"),
        "move_in": row.get("MVN_PREARNGE_YM"),
        "builder": row.get("CNSTRCT_ENTRPS_NM"),
        "area": row.get("SUBSCRPT_AREA_CODE_NM"),
        "homepage": row.get("HMPG_ADRES"),
    }
    out = [{
        "source_key": f"applyhome:{key}",
        "kind": "subscription",
        "title": name,
        "starts_on": _d(row.get("RCEPT_BGNDE")) or _d(row.get("RCRIT_PBLANC_DE")),
        "ends_on": _d(row.get("RCEPT_ENDDE")),
        "address": addr,
        "payload": payload,
        "source_url": row.get("PBLANC_URL"),
    }]
    move_in = _ym(row.get("MVN_PREARNGE_YM"))
    if move_in:
        out.append({
            "source_key": f"applyhome-movein:{key}",
            "kind": "move_in",
            "title": f"{name} 입주 예정",
            "starts_on": move_in,
            "ends_on": None,
            "address": addr,
            "payload": payload,
            "source_url": row.get("PBLANC_URL"),
        })
    return out


def fetch(since: date, conn=None, per_page: int = 200) -> list[dict]:
    if not settings.data_go_kr_key:
        raise RuntimeError("DATA_GO_KR_KEY 미설정")
    rows: list[dict] = []
    page = 1
    while True:
        http.count_call(conn, "data.go.kr:applyhome", settings.daily_quota_data_go_kr)
        r = http.get(URL, params={
            "serviceKey": settings.data_go_kr_key, "page": page, "perPage": per_page,
            "cond[RCRIT_PBLANC_DE::GTE]": since.isoformat(),
        })
        data = r.json()
        rows.extend(data.get("data") or [])
        if page * per_page >= int(data.get("matchCount") or data.get("totalCount") or 0) or not data.get("data"):
            break
        page += 1
    return rows


def parse_models(rows: list[dict]) -> list[dict]:
    """주택형별 행 → [{type, area(전용㎡), supply_area, top_price(만원), households}]. 주택형 '084.9800A' 의 숫자가 전용면적."""
    out = []
    for r in rows:
        ty = str(r.get("HOUSE_TY") or "").strip()
        try:
            area = float("".join(ch for ch in ty if ch.isdigit() or ch == ".") or "nan")
        except ValueError:
            area = float("nan")
        price = str(r.get("LTTOT_TOP_AMOUNT") or "").replace(",", "").strip()
        if not price.isdigit() or area != area:  # NaN
            continue
        supply = str(r.get("SUPLY_AR") or "").replace(",", "").strip()
        hh = str(r.get("SUPLY_HSHLDCO") or "").replace(",", "").strip()
        out.append({
            "type": ty,
            "area": round(area, 2),
            "supply_area": float(supply) if supply.replace(".", "", 1).isdigit() else None,
            "top_price": int(price),
            "households": int(hh) if hh.isdigit() else None,
        })
    return out


def fetch_models(house_manage_no: str, conn=None) -> list[dict]:
    http.count_call(conn, "data.go.kr:applyhome", settings.daily_quota_data_go_kr)
    r = http.get(MODEL_URL, params={
        "serviceKey": settings.data_go_kr_key, "page": 1, "perPage": 100,
        "cond[HOUSE_MANAGE_NO::EQ]": house_manage_no,
    })
    return parse_models(r.json().get("data") or [])
