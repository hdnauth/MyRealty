"""서울 밖 정비구역: 시·도 정비사업 시스템과 공공데이터포털 시·군·구 파일.

| 출처 | 범위 | 받는 방법 |
|---|---|---|
| 경기도 정비사업 종합관리 시스템(gg.go.kr/onnuri) | 경기 약 290곳 | 사업장 검색 화면에 들어 있는 목록(이름·주소·단계) + 사업장 상세(세부 단계) |
| 부산 정비사업 통합홈페이지(dynamice.busan.go.kr) | 부산 약 420곳 | 사업장 목록 표(이름·시군구·대표지번·단계) |
| 인천 정비사업 정보(renewal.incheon.go.kr) | 인천 약 150곳 | 사업장 검색 표(자치구·유형·단계·구역명·대표지번), 쪽 단위 |
| 공공데이터포털 파일 | 대전(재개발·재건축·주거환경개선), 광주 동구, 경주 | CSV(위치·세대수·추진현황) |

모두 주소(대표지번)를 지오코딩해 점으로 저장한다. 단계 표기는 zone_common.stage_order 가 9단계로 맞춘다.
"""

from __future__ import annotations

import csv
import html
import io
import json
import logging
import re
import time
from urllib.parse import urlencode

import httpx

from .. import http
from .zone_common import dedupe_id, upsert_record

log = logging.getLogger(__name__)


def _cell(raw: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", raw)).split())


def _rows(table_html: str) -> list[list[str]]:
    return [[_cell(td) for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
            for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, re.S)]


def clean_address(addr: str | None) -> str | None:
    """'경기도 의정부시 가능동(가능동) 681-2번지 일원' → '경기도 의정부시 가능동 681-2'."""
    if not addr:
        return None
    s = re.sub(r"\S+동\((\S+?[동리가])\)", r"\1", addr)        # 행정동(법정동) → 법정동
    s = re.sub(r"\((?:[^)]*)\)", " ", s)                       # 나머지 괄호 설명
    s = re.sub(r"(번지)?\s*(일원|일대|외\s*\d*\s*필지|외).*$", "", s)
    s = re.sub(r"번지", "", s)
    s = re.sub(r"([동리])(\d)", r"\1 \2", s)                   # '신흥동161-33' → '신흥동 161-33'
    s = " ".join(s.split())
    return s or None


# ───── 경기도 ─────

GG_LIST = "https://www.gg.go.kr/onnuri/view.do?no=109"
GG_DETAIL = "https://www.gg.go.kr/onnuri/mbiz/portal/bplc/rdv/ajaxGetSelectData.do"
GG_SHOW = "https://www.gg.go.kr/onnuri/view.do?no=114&pgMode=show&bizaraId="


def parse_gyeonggi(page: str) -> list[dict]:
    """사업장 검색 화면의 `var bizaraList = [...]` → 레코드 목록."""
    i = page.find("var bizaraList = [")
    if i < 0:
        return []
    block = page[i:page.find("];", i)]
    out = []
    for obj in re.findall(r"\{(.*?)\}", block, re.S):
        f = dict(re.findall(r"(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'", obj))
        if not f.get("bizaraId") or not f.get("bizaraNm"):
            continue
        out.append({"id": f["bizaraId"], "name": html.unescape(f["bizaraNm"]).replace("․", "·"), "addr": f.get("addr"),
                    "sgg": f.get("sigunSeNm"), "kind": f.get("bizTypeNm"), "stage": f.get("bizaraStepNm")})
    return out


def _gg_detail(client: httpx.Client, token: str | None, biz_id: str, tries: int = 2) -> dict | None:
    for attempt in range(tries):
        try:
            r = client.post(GG_DETAIL, data={"bizaraId": biz_id}, headers={"X-CSRF-TOKEN": token or ""}, timeout=20)
            msg = json.loads(r.text).get("message") or []
            if msg:
                return msg[0]
        except (httpx.HTTPError, ValueError) as e:
            log.warning("경기 사업장 상세 실패 %s: %s", biz_id, e)
        if attempt + 1 < tries:
            time.sleep(1.5)
    return None


def collect_gyeonggi(conn, detail: bool = True) -> dict:
    # 상세는 같은 세션(쿠키·CSRF 토큰)이 필요해 전용 클라이언트를 쓴다(중계 대상 아님)
    with httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (MyRealty-ETL)"}) as client:
        page = client.get(GG_LIST).text
        rows = parse_gyeonggi(page)
        if len(rows) < 50:
            raise ValueError(f"경기 정비사업 목록을 읽지 못했습니다({len(rows)}건)")
        token = (re.search(r'X-CSRF-TOKEN",\s*"([^"]+)"', page) or [None, None])[1]
        stats = {"rows": len(rows), "new": 0, "changed": 0, "same": 0, "detail": 0}
        seen: dict[str, int] = {}
        for r in rows:
            stage, extra = r["stage"], {}
            if detail:
                d = _gg_detail(client, token, r["id"])
                if not d and conn.execute("select 1 from redevelopment_zones where source_key = %s", (f"gyeonggi:{r['id']}",)).fetchone():
                    # 상세를 못 받으면 목록의 묶음 단계('조합(시행자)')로 덮어써 가짜 단계 변경이 생긴다 — 이번엔 건너뛴다
                    stats["detail_failed"] = stats.get("detail_failed", 0) + 1
                    continue
                if d:
                    stats["detail"] += 1
                    stage = d.get("bizaraPrgrsStepNm") or stage
                    extra = {"group_stage": r["stage"], "owners": d.get("landOwnerCnt"), "members": d.get("gldMbrCnt"),
                             "method": d.get("enfcMthdNm"), "zoning": (d.get("cmmBizSumry") or {}).get("ctyPlanZngNm")}
                time.sleep(0.15)
            rec = {"source": "gyeonggi", "source_id": r["id"], "sido": "경기도", "sgg_name": r["sgg"], "name": r["name"],
                   "kind_raw": r["kind"], "stage": stage, "address": clean_address(r["addr"]), "url": GG_SHOW + r["id"],
                   "attrs": {k: v for k, v in extra.items() if v not in (None, "", "0")}}
            stats[upsert_record(conn, dedupe_id(seen, rec))] += 1
            conn.commit()
    return stats


# ───── 부산 ─────

BS_LIST = "https://dynamice.busan.go.kr/view.do"


def parse_busan(page: str) -> list[dict]:
    i = page.find("<tbody")
    out = []
    for tds in _rows(page[i:page.find("</tbody>", i)] if i >= 0 else ""):
        if len(tds) < 5 or not tds[1]:
            continue
        name, sgg, addr, stage = tds[1], tds[2], tds[3], tds[4]
        out.append({"name": name, "sgg": sgg, "addr": addr or None, "stage": stage or None})
    return out


def collect_busan(conn) -> dict:
    page = http.get(BS_LIST, params={"no": "279", "pageIndex": "1", "recordCountPerPage": "2000", "pageUnit": "2000"}).text
    rows = parse_busan(page)
    if len(rows) < 50:
        raise ValueError(f"부산 정비사업 목록을 읽지 못했습니다({len(rows)}건)")
    stats = {"rows": len(rows), "new": 0, "changed": 0, "same": 0}
    seen: dict[str, int] = {}
    for r in rows:
        addr = clean_address(r["addr"])
        if addr and r["sgg"] and r["sgg"] not in addr:
            addr = f"{r['sgg']} {addr}"
        rec = {"source": "busan", "source_id": f"{r['sgg']}:{r['name']}", "sido": "부산광역시", "sgg_name": r["sgg"],
               "name": r["name"], "kind_raw": r["name"], "stage": r["stage"], "address": addr,
               "url": f"{BS_LIST}?no=279"}
        stats[upsert_record(conn, dedupe_id(seen, rec))] += 1
        conn.commit()
    return stats


# ───── 인천 ─────

IC_LIST = "https://renewal.incheon.go.kr/ires/program/0000-0011-0025/program/business/search.do"


def parse_incheon(page: str) -> list[dict]:
    i = page.find("<tbody")
    out = []
    for tds in _rows(page[i:page.find("</tbody>", i)] if i >= 0 else ""):
        if len(tds) < 6 or not tds[4]:
            continue
        name = re.sub(r"\s*/\s*정비구역후보지.*$", "", tds[4])
        out.append({"no": tds[0], "sgg": tds[1], "kind": tds[2], "stage": tds[3], "name": name, "addr": tds[5] or None,
                    "candidate": "후보지" in tds[4]})
    return out


def collect_incheon(conn, max_pages: int = 40) -> dict:
    rows: list[dict] = []
    with httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (MyRealty-ETL)"}) as client:
        for page_no in range(1, max_pages + 1):
            r = client.post(IC_LIST, data={"page": str(page_no), "searchCondition": "1", "searchKeyword": ""})
            got = parse_incheon(r.text)
            if not got:
                break
            rows += got
            time.sleep(0.2)
    if len(rows) < 30:
        raise ValueError(f"인천 정비사업 목록을 읽지 못했습니다({len(rows)}건)")
    stats = {"rows": len(rows), "new": 0, "changed": 0, "same": 0}
    seen: dict[str, int] = {}
    for r in rows:
        addr = clean_address(r["addr"])
        rec = {"source": "incheon", "source_id": f"{r['sgg']}:{r['name']}", "sido": "인천광역시", "sgg_name": r["sgg"],
               "name": r["name"], "kind_raw": r["kind"], "stage": r["stage"],
               "address": f"인천광역시 {r['sgg']} {addr}" if addr else None, "url": IC_LIST,
               "attrs": {"candidate": True} if r["candidate"] else None}
        stats[upsert_record(conn, dedupe_id(seen, rec))] += 1
        conn.commit()
    return stats


# ───── 공공데이터포털 파일 ─────

DATA_GO_KR_FILES: list[dict] = [
    {"pk": "15068530", "sido": "대전광역시", "kind": "재개발"},
    {"pk": "15077286", "sido": "대전광역시", "kind": "재건축"},
    {"pk": "15068529", "sido": "대전광역시", "kind": "주거환경개선"},
    {"pk": "15112709", "sido": "전남광주통합특별시", "sgg": "동구", "kind": None},
    {"pk": "15097852", "sido": "경상북도", "sgg": "경주시", "kind": "재건축"},
]


def download_data_go_kr(pk: str) -> str | None:
    """공공데이터포털 파일데이터(로그인 없이 받는 원문 파일) → 텍스트. 실패하면 None."""
    try:
        with httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (MyRealty-ETL)"}) as c:
            page = c.get(f"https://www.data.go.kr/data/{pk}/fileData.do").text
            m = re.search(r"fn_fileDataDown\('(\d+)',\s*'([^']+)'", page)
            if not m:
                return None
            meta = c.post("https://www.data.go.kr/tcs/dss/selectFileDataDownload.do",
                          data={"publicDataDetailPk": m.group(2), "publicDataPk": pk, "atchFileId": "", "fileDetailSn": "1",
                                "publicDataTyCode": "PR0051"}).json()
            if not meta.get("status"):
                return None
            q = urlencode({"atchFileId": meta["atchFileId"], "fileDetailSn": meta["fileDetailSn"], "dataNm": pk})
            raw = c.get(f"https://www.data.go.kr/cmm/cmm/fileDownload.do?{q}").content
    except (httpx.HTTPError, ValueError) as e:
        log.warning("공공데이터포털 파일 %s 받기 실패: %s", pk, e)
        return None
    for enc in ("utf-8-sig", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return None


def _col(row: dict, *names: str) -> str | None:
    for k, v in row.items():
        kk = (k or "").replace(" ", "")
        if any(n in kk for n in names) and v and str(v).strip():
            return str(v).strip()
    return None


def parse_file(text: str, meta: dict) -> list[dict]:
    """컬럼 이름이 조금씩 다른 시·군·구 CSV → 레코드(구역명·위치·세대수·추진현황)."""
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        name = _col(row, "구역명", "사업장명", "재건축명")
        if not name:
            continue
        sgg = meta.get("sgg") or _col(row, "시군구", "행정구역", "구명") or ""
        sgg = sgg.split()[-1] if sgg else ""
        stage = _col(row, "추진현황", "진행단계", "추진단계")
        hh = _col(row, "세대수")
        area = _col(row, "면적")
        loc = _col(row, "위치", "소재지", "주소")
        out.append({
            "source": f"dgk{meta['pk']}", "source_id": f"{sgg}:{name}", "sido": meta["sido"], "sgg_name": sgg, "name": name,
            "kind_raw": meta.get("kind") or _col(row, "구분", "사업유형") or name, "stage": stage,
            "address": f"{meta['sido']} {sgg} {clean_address(loc)}" if loc else None,
            "households_plan": int(re.sub(r"[^\d]", "", hh)) if hh and re.sub(r"[^\d]", "", hh) else None,
            "area_m2": float(re.sub(r"[^\d.]", "", area)) if area and re.sub(r"[^\d.]", "", area) and "ha" not in area else None,
            "url": f"https://www.data.go.kr/data/{meta['pk']}/fileData.do",
        })
    return out


def collect_files(conn) -> dict:
    stats = {"files": 0, "rows": 0, "new": 0, "changed": 0, "same": 0, "failed": []}
    seen: dict[str, int] = {}
    for meta in DATA_GO_KR_FILES:
        text = download_data_go_kr(meta["pk"])
        if not text:
            stats["failed"].append(meta["pk"])
            continue
        stats["files"] += 1
        for rec in parse_file(text, meta):
            stats["rows"] += 1
            stats[upsert_record(conn, dedupe_id(seen, rec))] += 1
        conn.commit()
    return stats
