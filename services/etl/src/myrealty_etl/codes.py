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

# 관심물건 유형 → 실거래 수집 유형 (임야는 토지 거래에서 지목='임야'로 필터)
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
