"""거시·통계 API: 한국은행 ECOS, KOSIS, 한국부동산원 R-ONE → series / series_values."""

from __future__ import annotations

import logging
from datetime import date

from dateutil.relativedelta import relativedelta

from .. import http, series_catalog
from ..codes import to_float
from ..config import settings

log = logging.getLogger(__name__)


def period_to_date(p: str, freq: str) -> date | None:
    """'202608' → 2026-08-01, '2026Q3' → 2026-07-01, '2026' → 2026-01-01, '20260915' → 날짜."""
    p = p.strip()
    try:
        if len(p) == 8 and p.isdigit():
            return date(int(p[:4]), int(p[4:6]), int(p[6:]))
        if len(p) == 6 and p.isdigit():
            return date(int(p[:4]), int(p[4:]), 1)
        if "Q" in p:
            y, q = p.split("Q")
            return date(int(y), (int(q) - 1) * 3 + 1, 1)
        if len(p) == 4 and p.isdigit():
            return date(int(p), 1, 1)
    except ValueError:
        return None
    return None


def parse_ecos(data: dict) -> list[tuple[date, float]]:
    block = data.get("StatisticSearch")
    if not block:
        res = data.get("RESULT") or {}
        if res.get("CODE") == "INFO-200":  # 데이터 없음
            return []
        raise RuntimeError(f"ECOS 오류 {res.get('CODE')}: {res.get('MESSAGE')}")
    out = []
    for r in block.get("row", []):
        d, v = period_to_date(r.get("TIME", ""), "M"), to_float(r.get("DATA_VALUE"))
        if d and v is not None:
            out.append((d, v))
    return out


def fetch_ecos(s: dict, start: date, end: date, conn=None) -> list[tuple[date, float]]:
    fmt = {"M": "%Y%m", "D": "%Y%m%d", "A": "%Y", "Q": "%YQ"}[s["cycle"]]
    s_from = start.strftime(fmt) if s["cycle"] != "Q" else f"{start.year}Q{(start.month - 1) // 3 + 1}"
    s_to = end.strftime(fmt) if s["cycle"] != "Q" else f"{end.year}Q{(end.month - 1) // 3 + 1}"
    http.count_call(conn, "ecos")
    url = (f"https://ecos.bok.or.kr/api/StatisticSearch/{settings.ecos_key}/json/kr/1/10000/"
           f"{s['stat']}/{s['cycle']}/{s_from}/{s_to}/{s['item']}")
    return parse_ecos(http.get(url).json())


def parse_kosis(rows: list | dict) -> list[tuple[str, str, date, float]]:
    """→ [(지역코드, 지역명, 기간, 값)]"""
    if isinstance(rows, dict):  # 오류 응답
        raise RuntimeError(f"KOSIS 오류 {rows.get('err')}: {rows.get('errMsg')}")
    out = []
    for r in rows:
        d, v = period_to_date(r.get("PRD_DE", ""), "M"), to_float(r.get("DT"))
        if d and v is not None:
            out.append((r.get("C1", ""), r.get("C1_NM", ""), d, v))
    return out


def fetch_kosis(s: dict, start: date, end: date, conn=None) -> list[tuple[str, str, date, float]]:
    http.count_call(conn, "kosis")
    r = http.get("https://kosis.kr/openapi/Param/statisticsParameterData.do", params={
        "method": "getList", "apiKey": settings.kosis_key, "format": "json", "jsonVD": "Y",
        "orgId": s["orgId"], "tblId": s["tblId"], "itmId": s["itmId"], "objL1": s["objL1"],
        "prdSe": s["freq"], "startPrdDe": start.strftime("%Y%m"), "endPrdDe": end.strftime("%Y%m"),
    })
    return parse_kosis(r.json())


def parse_reb(data: dict) -> list[tuple[str, str, date, float]]:
    blocks = data.get("SttsApiTblData") or []
    if not blocks:
        res = data.get("RESULT") or {}
        raise RuntimeError(f"R-ONE 오류 {res.get('CODE')}: {res.get('MESSAGE')}")
    rows = next((b["row"] for b in blocks if "row" in b), [])
    out = []
    for r in rows:
        wt = str(r.get("WRTTIME_IDTFR_ID", ""))
        d = period_to_date(wt[:8] if len(wt) >= 8 else wt, "W")
        v = to_float(r.get("DTA_VAL"))
        if d and v is not None:
            out.append((str(r.get("CLS_ID", "")), r.get("CLS_NM", ""), d, v))
    return out


def upsert_series(conn, code: str, meta: dict, values: list[tuple[date, float]], *, category: str = "macro",
                  region_cd: str | None = None) -> int:
    conn.execute(
        """insert into series (code, name, unit, freq, source, category, region_cd, description, updated_at)
           values (%s, %s, %s, %s, %s, %s, %s, %s, now())
           on conflict (code) do update set name = excluded.name, unit = excluded.unit, updated_at = now()""",
        (code, meta["name"], meta.get("unit"), meta.get("freq", "M"), meta.get("source", "ecos"), category, region_cd,
         meta.get("description")),
    )
    with conn.cursor() as cur:
        cur.executemany(
            """insert into series_values (code, period, value) values (%s, %s, %s)
               on conflict (code, period) do update set value = excluded.value""",
            [(code, d, v) for d, v in values],
        )
    return len(values)


def collect_macro(conn, years: int = 12, today: date | None = None) -> dict:
    today = today or date.today()
    start = today.replace(day=1) - relativedelta(years=years)
    stats: dict = {}
    if settings.ecos_key:
        for s in series_catalog.ecos():
            if not s.get("enabled"):
                continue
            try:
                vals = fetch_ecos(s, start, today, conn)
                stats[s["code"]] = upsert_series(conn, s["code"], {**s, "source": "ecos"}, vals)
                conn.commit()
            except Exception as e:
                conn.rollback()
                log.warning("ECOS %s 실패: %s", s["code"], e)
                stats[s["code"]] = f"error: {e}"
    else:
        stats["ecos"] = "skipped: ECOS_KEY 미설정"
    if settings.kosis_key:
        for s in series_catalog.kosis():
            if not s.get("enabled"):
                continue
            try:
                by_region: dict[str, list] = {}
                names: dict[str, str] = {}
                for rc, rn, d, v in fetch_kosis(s, start, today, conn):
                    by_region.setdefault(rc, []).append((d, v))
                    names[rc] = rn
                for rc, vals in by_region.items():
                    code = s["code"].format(region=rc)
                    upsert_series(conn, code, {**s, "name": f"{s['name']} {names[rc]}", "source": "kosis"}, vals, category="region")
                conn.commit()
                stats[s["code"]] = len(by_region)
            except Exception as e:
                conn.rollback()
                log.warning("KOSIS %s 실패: %s", s["code"], e)
                stats[s["code"]] = f"error: {e}"
    else:
        stats["kosis"] = "skipped: KOSIS_KEY 미설정"
    if settings.reb_key:
        for s in series_catalog.reb():
            if not (s.get("enabled") and s.get("statbl")):
                continue
            try:
                http.count_call(conn, "reb")
                r = http.get("https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do", params={
                    "KEY": settings.reb_key, "Type": "json", "STATBL_ID": s["statbl"], "DTACYCLE_CD": s["cycle"],
                    "pIndex": 1, "pSize": 1000,
                })
                by_region: dict[str, list] = {}
                for rc, _name, d, v in parse_reb(r.json()):
                    by_region.setdefault(rc, []).append((d, v))
                for rc, vals in by_region.items():
                    upsert_series(conn, s["code"].format(region=rc), {**s, "source": "reb"}, vals, category="region")
                conn.commit()
                stats[s["code"]] = len(by_region)
            except Exception as e:
                conn.rollback()
                log.warning("R-ONE %s 실패: %s", s["code"], e)
                stats[s["code"]] = f"error: {e}"
    else:
        stats["reb"] = "skipped: REB_KEY 미설정"
    return stats
