"""서울시 정비사업 정보몽땅(cleanup.seoul.go.kr) 사업장 목록 → 정비구역(redevelopment_zones).

공식 OpenAPI(열린데이터광장 OA-2253)가 종료돼 사업장 검색 화면의 목록 표를 읽는다. 한 번에 전체(약 1,200곳)를 받고
자치구·사업구분·사업장명·대표지번·진행단계를 저장한다. 좌표는 대표지번 지오코딩(점)이고, 구역 경계는
seoul_boundaries(서울시 의제처리구역 SHP)가 결정고시 코드(map_code)로 덧씌운다.
"""

from __future__ import annotations

import html
import logging
import re

from .. import http
from .zone_common import upsert_record

log = logging.getLogger(__name__)

LIST_URL = "https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do"
CAFE_URL = "https://cleanup.seoul.go.kr/cafe/mainIndx.do?cafeUrl="

SEOUL_SGG = {
    "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200", "광진구": "11215", "동대문구": "11230",
    "중랑구": "11260", "성북구": "11290", "강북구": "11305", "도봉구": "11320", "노원구": "11350", "은평구": "11380",
    "서대문구": "11410", "마포구": "11440", "양천구": "11470", "강서구": "11500", "구로구": "11530", "금천구": "11545",
    "영등포구": "11560", "동작구": "11590", "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710",
    "강동구": "11740",
}


def _cell(raw: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", raw)).split())


def parse_list(page: str) -> list[dict]:
    """사업장 목록 표 → [{gu, kind_raw, name, jibun, stage, cafe, map_code}]."""
    start = page.find("사업장 목록")
    if start < 0:
        return []
    table = page[start:page.find("</table>", start)]
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) < 6:
            continue
        cafe = re.search(r"cafeOpenPopup\('([^']+)'", tr)
        code = re.search(r"mapOpenPopup\('([^']+)'", tr)
        gu, kind_raw, name, jibun, stage = (_cell(t) for t in tds[1:6])
        if not name or gu not in SEOUL_SGG:
            continue
        out.append({"gu": gu, "kind_raw": kind_raw, "name": name, "jibun": jibun, "stage": stage or None,
                    "cafe": cafe.group(1) if cafe else None, "map_code": code.group(1) if code else None})
    return out


def to_record(row: dict) -> dict:
    cafe_url = CAFE_URL + row["cafe"] if row["cafe"] else None
    return {
        "source": "seoul", "source_id": row["cafe"] or f"{row['gu']}:{row['name']}:{row['jibun']}",
        "sido": "서울특별시", "sgg_name": row["gu"], "sgg_cd": SEOUL_SGG[row["gu"]],
        "name": row["name"], "kind_raw": row["kind_raw"], "stage": row["stage"],
        "address": f"서울특별시 {row['gu']} {row['jibun']}".strip() if row["jibun"] else None,
        "url": cafe_url, "attrs": {"cafe_url": cafe_url, "map_code": row["map_code"]},
    }


def upsert(conn, row: dict) -> str:
    """한 사업장 반영. 반환: 'new' | 'changed' | 'same'."""
    return upsert_record(conn, to_record(row))


def collect_seoul_zones(conn) -> dict:
    page = http.get(LIST_URL, params={"cpage": "1", "pageSize": "3000"}).text
    rows = parse_list(page)
    if len(rows) < 100:  # 화면 구조가 바뀌었거나 차단 — 기존 자료를 지우지 않고 알린다
        raise ValueError(f"정비사업 정보몽땅 목록을 읽지 못했습니다({len(rows)}건)")
    stats = {"rows": len(rows), "new": 0, "changed": 0, "same": 0}
    for row in rows:
        stats[upsert(conn, row)] += 1
    conn.commit()
    log.info("서울 정비사업 %s", stats)
    return stats
