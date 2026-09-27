"""외부 통계 시계열 카탈로그.

통계표·항목 코드는 기관 사정으로 바뀔 수 있다. 수집 오류가 나면 각 포털의 통계코드 검색에서
코드를 확인해 여기(또는 환경 변수 SERIES_OVERRIDES_JSON)를 고친다. enabled=False 는 코드 확인 전 기본 비활성.
"""

from __future__ import annotations

import json
import os

# ECOS: https://ecos.bok.or.kr → 개발 가이드 → 통계코드 검색
ECOS = [
    {"code": "ecos.base_rate", "name": "한국은행 기준금리", "unit": "%", "freq": "M",
     "stat": "722Y001", "item": "0101000", "cycle": "M", "enabled": True},
    {"code": "ecos.mortgage_rate", "name": "예금은행 주택담보대출 금리(신규취급액)", "unit": "%", "freq": "M",
     "stat": "121Y006", "item": "BECBLA0302", "cycle": "M", "enabled": True},
    {"code": "ecos.bond_3y", "name": "국고채 3년 금리", "unit": "%", "freq": "M",
     "stat": "721Y001", "item": "5020000", "cycle": "M", "enabled": True},
    {"code": "ecos.cpi", "name": "소비자물가지수(총지수)", "unit": "2020=100", "freq": "M",
     "stat": "901Y009", "item": "0", "cycle": "M", "enabled": True},
    {"code": "ecos.m2", "name": "M2(광의통화, 평잔, 계절조정)", "unit": "십억원", "freq": "M",
     "stat": "101Y004", "item": "BBHA00", "cycle": "M", "enabled": True},
    {"code": "ecos.household_mortgage", "name": "예금취급기관 주택담보대출 잔액", "unit": "십억원", "freq": "M",
     "stat": "151Y005", "item": "11100A0", "cycle": "M", "enabled": False},
    # 소비자동향조사 주택가격전망 CSI(100 초과 = 오를 것이라는 응답이 많음). 항목 코드는 series-check 로 확인 후 활성화
    {"code": "ecos.housing_csi", "name": "주택가격전망 CSI", "unit": "지수(100=중립)", "freq": "M",
     "stat": "511Y002", "item": "FMFB", "cycle": "M", "enabled": False},
]

# KOSIS: https://kosis.kr/openapi → 통계자료 URL 생성에서 orgId·tblId·itmId·objL1 확인
KOSIS = [
    {"code": "kosis.unsold.{region}", "name": "미분양주택(시도)", "unit": "호", "freq": "M",
     "orgId": "116", "tblId": "DT_MLTM_2082", "itmId": "13103792722T1", "objL1": "ALL", "enabled": False},
    # 전국 한 계열만(objL1 = 전국 코드). 코드는 KOSIS '통계자료 URL 생성'에서 확인 후 SERIES_OVERRIDES_JSON 으로 덮어쓴다
    {"code": "kosis.unsold_done", "name": "준공 후 미분양(전국)", "unit": "호", "freq": "M",
     "orgId": "116", "tblId": "DT_MLTM_5328", "itmId": "", "objL1": "", "enabled": False},
    {"code": "kosis.permits", "name": "주택건설 인허가 실적(전국)", "unit": "호", "freq": "M",
     "orgId": "116", "tblId": "DT_MLTM_2100", "itmId": "", "objL1": "", "enabled": False},
    {"code": "kosis.starts", "name": "주택 착공 실적(전국)", "unit": "호", "freq": "M",
     "orgId": "116", "tblId": "DT_MLTM_5388", "itmId": "", "objL1": "", "enabled": False},
]

# 한국부동산원 R-ONE: https://www.reb.or.kr/r-one → OpenAPI → 통계표 목록에서 STATBL_ID 확인
REB = [
    # 전국 한 계열(CLS_ID 필터는 region_filter). 100 초과 = 매수자 우위
    {"code": "reb.supply_demand", "name": "아파트 매매수급지수(전국)", "unit": "지수(100=균형)", "freq": "W",
     "statbl": "", "cycle": "WK", "region_filter": "", "enabled": False},
    {"code": "reb.conv_rate", "name": "아파트 전월세전환율(전국)", "unit": "%", "freq": "M",
     "statbl": "", "cycle": "MM", "region_filter": "", "enabled": False},
    {"code": "reb.outside_buyer", "name": "아파트 매매 관할 시도 외 매입자 비중(전국)", "unit": "%", "freq": "M",
     "statbl": "", "cycle": "MM", "region_filter": "", "enabled": False},
    {"code": "reb.apt_sale_idx.{region}", "name": "주간 아파트 매매가격지수", "unit": "지수", "freq": "W",
     "statbl": "", "cycle": "WK", "enabled": False},
    {"code": "reb.apt_jeonse_idx.{region}", "name": "주간 아파트 전세가격지수", "unit": "지수", "freq": "W",
     "statbl": "", "cycle": "WK", "enabled": False},
]

# 가구 연소득(만원) 기본값: 통계청 가계금융복지조사(2024년 조사, 2023년 가구 평균 경상소득 약 7,185만원).
# KOSIS 연동 전까지 PIR·월부담지수 분모로 사용. INCOME_ANNUAL_MANWON 으로 바꿀 수 있다.
DEFAULT_ANNUAL_INCOME_MANWON = float(os.environ.get("INCOME_ANNUAL_MANWON", "7185"))


def _apply_overrides(lst: list[dict], key: str) -> list[dict]:
    raw = os.environ.get("SERIES_OVERRIDES_JSON")
    if not raw:
        return lst
    over = json.loads(raw).get(key, {})
    return [{**x, **over.get(x["code"], {})} for x in lst]


def all_entries() -> list[tuple[str, dict]]:
    """(출처, 항목) 전체 — series-check 용(비활성 포함)."""
    return [("ecos", x) for x in ecos()] + [("kosis", x) for x in kosis()] + [("reb", x) for x in reb()]


def ecos() -> list[dict]:
    return _apply_overrides(ECOS, "ecos")


def kosis() -> list[dict]:
    return _apply_overrides(KOSIS, "kosis")


def reb() -> list[dict]:
    return _apply_overrides(REB, "reb")
