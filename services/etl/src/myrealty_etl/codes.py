"""공통 코드·식별자 유틸리티 (PNU, 법정동코드, 이름 정규화, 숫자 파싱)."""

from __future__ import annotations

import re

PROPERTY_TYPES = {
    "apt": "아파트",
    "officetel": "오피스텔",
    "rowhouse": "연립/다세대",
    "house": "단독/다가구",
    "land": "토지",
    "forest": "임야",
    "commercial": "상업업무용",
    "presale": "분양권/입주권",
}

# 관심 부동산 유형 → 실거래 수집 유형 (임야는 토지 거래에서 지목='임야'로 필터)
WATCH_TO_TX_TYPE = {
    "apt": "apt",
    "officetel": "officetel",
    "rowhouse": "rowhouse",
    "house": "house",
    "land": "land",
    "forest": "land",
    "commercial": "commercial",
}

M2_PER_PYEONG = 3.305785


def make_pnu(lawd_cd: str, jibun: str | None = None, *, mountain: bool = False,
             bonbun: int | str | None = None, bubun: int | str | None = None) -> str | None:
    """법정동코드(10) + 산여부(1=일반, 2=산) + 본번(4) + 부번(4) = 19자리.

    jibun 은 '123-4', '산 12-3', '123' 형태를 허용한다. 마스킹('1**')이면 None.
    """
    if not lawd_cd or len(lawd_cd) != 10 or not lawd_cd.isdigit():
        return None
    if bonbun is None:
        if not jibun:
            return None
        s = jibun.strip()
        if s.startswith("산"):
            mountain = True
            s = s[1:].strip()
        m = re.fullmatch(r"(\d{1,4})(?:-(\d{1,4}))?", s)
        if not m:
            return None
        bonbun, bubun = m.group(1), m.group(2) or 0
    try:
        b1, b2 = int(bonbun), int(bubun or 0)
    except (TypeError, ValueError):
        return None
    return f"{lawd_cd}{2 if mountain else 1}{b1:04d}{b2:04d}"


def parse_pnu(pnu: str) -> dict | None:
    if not pnu or len(pnu) != 19 or not pnu.isdigit():
        return None
    return {
        "lawd_cd": pnu[:10],
        "sgg_cd": pnu[:5],
        "bjdong_cd": pnu[5:10],
        "mountain": pnu[10] == "2",
        "bonbun": pnu[11:15],
        "bubun": pnu[15:19],
        "jibun": f"{'산 ' if pnu[10] == '2' else ''}{int(pnu[11:15])}" + (f"-{int(pnu[15:19])}" if int(pnu[15:19]) else ""),
    }


_NAME_STRIP = re.compile(r"[\s\-_·.,()\[\]{}'\"]+")


def normalize_name(name: str | None) -> str:
    """단지명 표기 차이 흡수: 공백·괄호·구두점 제거, 소문자, 흔한 접미사 통일."""
    if not name:
        return ""
    s = name.strip().lower()
    s = _NAME_STRIP.sub("", s)
    for a, b in (("아파트", ""), ("apt", ""), ("apartment", ""), ("e편한세상", "이편한세상"),
                 ("e-편한세상", "이편한세상"), ("sk", "에스케이"), ("lg", "엘지"), ("gs", "지에스")):
        s = s.replace(a, b)
    return s


def to_int(v: str | int | float | None) -> int | None:
    """'158,000' → 158000, '' → None."""
    if v is None:
        return None
    if isinstance(v, int | float):
        return int(v)
    s = str(v).replace(",", "").strip()
    if not s or s == "-":
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def to_float(v: str | float | None) -> float | None:
    if v is None:
        return None
    if isinstance(v, int | float):
        return float(v)
    s = str(v).replace(",", "").strip()
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ───── 행정구역 개편(2026 전남광주통합특별시) 신·구 코드 ─────
# 공공데이터포털(실거래·건축물대장)은 새 시군구 코드(12xxx)로만, 브이월드(토지특성·공시지가·공동주택가격)는
# 아직 옛 코드(전라남도 46xxx·광주광역시 29xxx)로만 답한다. 읍면동·리 이하 5자리는 그대로라 앞 5자리만 바꾸면 된다.
# 새 코드는 시군구 이름으로 옛 코드에 대응시킨다(새 코드 체계를 몰라도 regions 의 이름으로 찾는다).
LEGACY_SGG_BY_NAME: dict[str, dict[str, str]] = {
    "전남광주통합특별시": {
        "목포시": "46110", "여수시": "46130", "순천시": "46150", "나주시": "46170", "광양시": "46230",
        "담양군": "46710", "곡성군": "46720", "구례군": "46730", "고흥군": "46770", "보성군": "46780",
        "화순군": "46790", "장흥군": "46800", "강진군": "46810", "해남군": "46820", "영암군": "46830",
        "무안군": "46840", "함평군": "46860", "영광군": "46870", "장성군": "46880", "완도군": "46890",
        "진도군": "46900", "신안군": "46910",
        "동구": "29110", "서구": "29140", "남구": "29155", "북구": "29170", "광산구": "29200",
    },
}


def legacy_sgg(sido: str | None, sigungu: str | None) -> str | None:
    """개편된 시도의 시군구 이름 → 옛 시군구 코드(없으면 None)."""
    table = LEGACY_SGG_BY_NAME.get((sido or "").strip())
    if not table or not sigungu:
        return None
    name = sigungu.strip().split()[-1]
    return table.get(name)


def legacy_pnu(pnu: str | None, sido: str | None, sigungu: str | None) -> str | None:
    """새 코드 PNU → 옛 코드 PNU(브이월드 조회용). 해당 없으면 None."""
    if not pnu or len(pnu) != 19:
        return None
    old = legacy_sgg(sido, sigungu)
    return f"{old}{pnu[5:]}" if old and old != pnu[:5] else None
