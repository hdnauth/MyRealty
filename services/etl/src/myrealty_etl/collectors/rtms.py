"""국토교통부 실거래가 공개 API (공공데이터포털, apis.data.go.kr/1613000).

요청: LAWD_CD(시군구 5자리) + DEAL_YMD(YYYYMM), 응답: XML.
서비스별 필드명이 조금씩 달라 후보 키 목록으로 흡수한다. 신규 명세(2024~)의 영문 태그 기준.
"""

from __future__ import annotations

import hashlib
import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date

from .. import http
from ..codes import normalize_name, to_float, to_int
from ..config import settings

log = logging.getLogger(__name__)

BASE = "https://apis.data.go.kr/1613000"


@dataclass(frozen=True)
class Service:
    property_type: str
    kind: str  # sale | rent
    path: str


SERVICES: list[Service] = [
    Service("apt", "sale", "RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"),
    Service("apt", "rent", "RTMSDataSvcAptRent/getRTMSDataSvcAptRent"),
    Service("rowhouse", "sale", "RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade"),
    Service("rowhouse", "rent", "RTMSDataSvcRHRent/getRTMSDataSvcRHRent"),
    Service("house", "sale", "RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade"),
    Service("house", "rent", "RTMSDataSvcSHRent/getRTMSDataSvcSHRent"),
    Service("officetel", "sale", "RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade"),
    Service("officetel", "rent", "RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent"),
    Service("land", "sale", "RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade"),
    Service("commercial", "sale", "RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade"),
    Service("presale", "sale", "RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade"),
]

NAME_KEYS = {
    "apt": ("aptNm", "아파트"),
    "presale": ("aptNm", "단지"),
    "officetel": ("offiNm", "단지"),
    "rowhouse": ("mhouseNm", "연립다세대"),
    "commercial": ("buildingUse",),
}
AREA_KEYS = ("excluUseAr", "totalFloorAr", "buildingAr", "dealArea", "전용면적", "연면적", "거래면적")
LAND_AREA_KEYS = ("landAr", "plottageAr", "대지권면적", "대지면적")


class RtmsError(RuntimeError):
    pass


def _g(item: dict, *keys: str) -> str | None:
    for k in keys:
        v = item.get(k)
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return None


def parse_xml(text: str) -> tuple[list[dict], int]:
    """응답 XML → (item dict 목록, totalCount). 오류 코드면 RtmsError."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        raise RtmsError(f"XML 파싱 실패: {text[:200]}") from e
    code = root.findtext(".//resultCode") or root.findtext(".//returnReasonCode")
    if code not in (None, "00", "000"):
        msg = root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg") or ""
        raise RtmsError(f"RTMS 오류 {code}: {msg}")
    items = [{child.tag: (child.text or "").strip() for child in it} for it in root.iter("item")]
    total = to_int(root.findtext(".//totalCount")) or len(items)
    return items, total


def _deal_date(item: dict) -> date | None:
    y, m, d = to_int(_g(item, "dealYear", "년")), to_int(_g(item, "dealMonth", "월")), to_int(_g(item, "dealDay", "일"))
    if not (y and m and d):
        return None
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _cancel_date(s: str | None) -> date | None:
    """'24.08.01' 또는 '2024-08-01' → date."""
    if not s:
        return None
    parts = s.replace("-", ".").split(".")
    if len(parts) != 3:
        return None
    try:
        y, m, d = (int(p) for p in parts)
    except ValueError:
        return None
    if y < 100:
        y += 2000
    try:
        return date(y, m, d)
    except ValueError:
        return None


def normalize(item: dict, svc: Service, sgg_cd: str) -> dict | None:
    """원천 item → transactions 행(dict). 거래일이 없으면 None."""
    deal_date = _deal_date(item)
    if deal_date is None:
        return None
    name = _g(item, *NAME_KEYS.get(svc.property_type, ()))
    if svc.kind == "sale":
        deal_kind = "sale"
        price = to_int(_g(item, "dealAmount", "거래금액"))
        rent = None
    else:
        price = to_int(_g(item, "deposit", "보증금액"))
        rent = to_int(_g(item, "monthlyRent", "월세금액")) or 0
        deal_kind = "wolse" if rent > 0 else "jeonse"
    umd_cd = _g(item, "umdCd")
    item_sgg = _g(item, "sggCd") or sgg_cd
    lawd_cd = f"{item_sgg}{umd_cd}" if umd_cd and len(item_sgg) == 5 and len(umd_cd) == 5 else None
    cdeal = _g(item, "cdealType", "해제여부")
    renewal = _g(item, "useRRRight", "갱신요구권사용")
    row = {
        "property_type": svc.property_type,
        "deal_kind": deal_kind,
        "sgg_cd": item_sgg[:5],
        "lawd_cd": lawd_cd,
        "umd_nm": _g(item, "umdNm", "법정동"),
        "jibun": _g(item, "jibun", "지번"),
        "name": name,
        "apt_seq": _g(item, "aptSeq"),
        "apt_dong": _g(item, "aptDong"),
        "house_type": _g(item, "houseType", "buildingType", "주택유형"),
        "jimok": _g(item, "jimok", "지목"),
        "land_use": _g(item, "landUse", "용도지역"),
        "area_m2": to_float(_g(item, *AREA_KEYS)),
        "land_area_m2": to_float(_g(item, *LAND_AREA_KEYS)),
        "floor": to_int(_g(item, "floor", "층")),
        "build_year": to_int(_g(item, "buildYear", "건축년도")),
        "deal_date": deal_date,
        "price": price,
        "monthly_rent": rent,
        "contract_term": _g(item, "contractTerm", "계약기간"),
        "renewal_used": (renewal == "사용") if renewal else None,
        "is_direct": (_g(item, "dealingGbn", "거래유형") == "직거래") if _g(item, "dealingGbn", "거래유형") else None,
        "is_canceled": cdeal == "O",
        "buyer_type": _g(item, "buyerGbn", "매수자"),
        "seller_type": _g(item, "slerGbn", "매도자"),
        "registered_at": _cancel_date(_g(item, "rgstDate", "등기일자")),
        "contract_type": {"신규": "new", "갱신": "renewal"}.get(_g(item, "contractType", "계약구분") or ""),
        "prev_deposit": to_int(_g(item, "preDeposit", "종전계약보증금")),
        "prev_rent": to_int(_g(item, "preMonthlyRent", "종전계약월세")),
        "canceled_at": _cancel_date(_g(item, "cdealDay", "해제사유발생일")),
        "raw": item,
    }
    row["src_hash"] = source_hash(row)
    return row


def source_hash(row: dict) -> str:
    """해제 여부처럼 나중에 바뀌는 값은 제외한 원천 식별 해시."""
    key = "|".join(
        str(row.get(k) or "")
        for k in ("property_type", "deal_kind", "sgg_cd", "umd_nm", "jibun", "name", "apt_dong", "area_m2",
                  "land_area_m2", "floor", "deal_date", "price", "monthly_rent", "house_type", "jimok")
    )
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def dedupe_hashes(rows: list[dict]) -> list[dict]:
    """같은 조건의 거래가 한 달에 여러 건이면 해시가 같아지므로 순번을 붙여 구분한다."""
    seen: dict[str, int] = {}
    for r in rows:
        h = r["src_hash"]
        n = seen.get(h, 0)
        seen[h] = n + 1
        if n:
            r["src_hash"] = hashlib.sha1(f"{h}#{n}".encode()).hexdigest()
    return rows


def fetch(svc: Service, sgg_cd: str, ym: str, *, conn=None, num_rows: int = 1000) -> list[dict]:
    """한 서비스·시군구·월의 전체 페이지를 받아 정규화 행 목록으로 반환."""
    if not settings.data_go_kr_key:
        raise RtmsError("DATA_GO_KR_KEY 미설정")
    rows: list[dict] = []
    page = 1
    while True:
        http.count_call(conn, f"data.go.kr:{svc.path.split('/')[0]}", settings.daily_quota_data_go_kr)
        r = http.get(
            f"{BASE}/{svc.path}",
            params={"serviceKey": settings.data_go_kr_key, "LAWD_CD": sgg_cd, "DEAL_YMD": ym,
                    "pageNo": page, "numOfRows": num_rows},
        )
        items, total = parse_xml(r.text)
        rows.extend(x for x in (normalize(it, svc, sgg_cd) for it in items) if x)
        if page * num_rows >= total or not items:
            break
        page += 1
    return dedupe_hashes(rows)


UPSERT_SQL = """
insert into transactions (src_hash, property_type, deal_kind, sgg_cd, lawd_cd, umd_nm, jibun, name, house_type,
  jimok, land_use, area_m2, land_area_m2, floor, build_year, deal_date, price, monthly_rent, contract_term,
  renewal_used, is_direct, is_canceled, canceled_at, buyer_type, seller_type, registered_at, contract_type,
  prev_deposit, prev_rent, raw, complex_id)
values (%(src_hash)s, %(property_type)s, %(deal_kind)s, %(sgg_cd)s, %(lawd_cd)s, %(umd_nm)s, %(jibun)s, %(name)s,
  %(house_type)s, %(jimok)s, %(land_use)s, %(area_m2)s, %(land_area_m2)s, %(floor)s, %(build_year)s, %(deal_date)s,
  %(price)s, %(monthly_rent)s, %(contract_term)s, %(renewal_used)s, %(is_direct)s, %(is_canceled)s, %(canceled_at)s,
  %(buyer_type)s, %(seller_type)s, %(registered_at)s, %(contract_type)s, %(prev_deposit)s, %(prev_rent)s,
  %(raw_json)s, %(complex_id)s)
on conflict (src_hash) do update set
  is_canceled = excluded.is_canceled,
  canceled_at = excluded.canceled_at,
  lawd_cd = coalesce(excluded.lawd_cd, transactions.lawd_cd),
  complex_id = coalesce(transactions.complex_id, excluded.complex_id),
  registered_at = coalesce(excluded.registered_at, transactions.registered_at),
  buyer_type = coalesce(excluded.buyer_type, transactions.buyer_type),
  seller_type = coalesce(excluded.seller_type, transactions.seller_type),
  raw = excluded.raw,
  updated_at = now()
where transactions.is_canceled is distinct from excluded.is_canceled
   or transactions.canceled_at is distinct from excluded.canceled_at
   or (transactions.complex_id is null and excluded.complex_id is not null)
   -- 등기는 신고 몇 달 뒤에 붙는다(최근 3개월 재수집 때 반영)
   or (transactions.registered_at is null and excluded.registered_at is not null)
returning id, (xmax = 0) as inserted
"""


# 상세 필드가 없는 행(테스트·구 명세)도 upsert 되도록
DETAIL_DEFAULTS = {k: None for k in ("buyer_type", "seller_type", "registered_at", "contract_type", "prev_deposit", "prev_rent")}


def upsert(conn, rows: list[dict]) -> dict:
    """행을 upsert 하고 {inserted, updated} 건수를 반환한다. 단지 매칭은 transforms.complexes 에서."""
    from ..db import jsonb

    stats = {"inserted": 0, "updated": 0}
    with conn.cursor() as cur:
        for row in rows:
            params = {**DETAIL_DEFAULTS, **row, "raw_json": jsonb(row["raw"]), "complex_id": row.get("complex_id")}
            cur.execute(UPSERT_SQL, params)
            res = cur.fetchone()
            if res:
                stats["inserted" if res["inserted"] else "updated"] += 1
    conn.commit()
    return stats


def complex_key(row: dict) -> str | None:
    """단지 식별 키. 아파트는 aptSeq 우선, 그 외는 유형|시군구|읍면동|지번|정규화이름."""
    ptype = row["property_type"]
    if ptype not in ("apt", "officetel", "rowhouse", "presale"):
        return None
    if ptype == "presale":
        ptype = "apt"
    if row.get("apt_seq"):
        return f"apt:{row['apt_seq']}"
    nn = normalize_name(row.get("name"))
    if not nn:
        return None
    return f"{ptype}|{row['sgg_cd']}|{row.get('umd_nm') or ''}|{row.get('jibun') or ''}|{nn}"
