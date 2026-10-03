"""교통 호재 시드(data/rail_projects.json) → infra_projects(역·노선).

계획·착공·최근 개통 철도 노선의 역을 브이월드 장소 검색으로 찾고(같은 이름 역이 여러 곳이면 힌트 주소의 시군구로 고른다),
없으면(신설역) 힌트 법정동 중심을 대략 위치로 쓴다. 노선은 역을 이은 개략선. 파일 내용이 바뀌거나 30일이 지나면 다시 넣는다.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

import httpx

from ..db import jsonb
from .zone_common import vworld_search

log = logging.getLogger(__name__)

SEED = Path(__file__).resolve().parent.parent / "data" / "rail_projects.json"
INFRA_STATUS = ["계획", "예타", "설계", "착공", "개통예정", "개통"]


def _hint_parts(hint: str) -> tuple[str, str, str]:
    """'경기 파주시 동패동' → ('경기', '파주시', '동패동'), '서울 강남구 삼성동' → ('서울', '강남구', '삼성동')."""
    parts = hint.split()
    return parts[0], " ".join(parts[1:-1]), parts[-1]


def resolve_station(name: str, hint: str) -> tuple[float, float, str] | None:
    sido, sgg, dong = _hint_parts(hint)
    sgg_last = sgg.split()[-1] if sgg else ""
    try:
        places = vworld_search(f"{name}역", size=15)
        in_area = [p for p in places if p["title"].startswith(f"{name}역") and "출입구" not in p["title"]
                   and ((sgg_last and sgg_last[:-1] in p["address"]) or sido[:2] in p["address"])]
        for p in in_area:
            if "철도" in p["category"] or "지하철" in p["category"]:
                return p["lng"], p["lat"], "station"
        # 역 시설이 아직 장소 목록에 없으면 같은 이름의 역 앞 정류장·시설(힌트 동 안)
        for p in in_area:
            if dong in p["address"]:
                return p["lng"], p["lat"], "place"
        for d in vworld_search(dong, kind="district", category="L4", size=30):
            if sgg_last[:-1] in d["title"] and sido[:2] in d["title"]:
                return d["lng"], d["lat"], "dong"
    except (httpx.HTTPError, ValueError) as e:
        log.warning("역 위치 검색 실패 %s: %s", name, e)
    return None


def collect_rail_seed(conn, force: bool = False) -> dict:
    raw = SEED.read_bytes()
    digest = hashlib.sha1(raw).hexdigest()[:12]
    key = f"rail_seed:{digest}"
    done = conn.execute("select fetched_at > now() - interval '30 days' as ok from poi_fetches where key = %s", (key,)).fetchone()
    if done and done["ok"] and not force:
        return {"skipped": "unchanged"}
    data = json.loads(raw)
    stats = {"lines": 0, "stations": 0, "unresolved": []}
    cache: dict[tuple[str, str], tuple[float, float, str] | None] = {}
    for ln in data["lines"]:
        status = ln["status"]
        when = ln.get("opened") or (f"{ln['target_year']}-12-01" if ln.get("target_year") else None)
        pts = []
        for seq, (st_name, hint) in enumerate(ln["stations"]):
            ck = (st_name, hint)
            if ck not in cache:
                cache[ck] = resolve_station(st_name, hint)
            pt = cache[ck]
            if not pt:
                stats["unresolved"].append(f"{ln['line']} {st_name}")
                continue
            pts.append(pt)
            attrs = {"seed": data["as_of"], "segment": ln["segment"], "seq": seq, "precision": pt[2], "hint": hint,
                     "target_year": ln.get("target_year"), "note": data["note"]}
            conn.execute(
                """insert into infra_projects (source_key, kind, name, line_name, status, status_order, expected_open, geom, attrs, updated_at)
                   values (%s, 'station', %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, now())
                   on conflict (source_key) do update set name = excluded.name, line_name = excluded.line_name, status = excluded.status,
                     status_order = excluded.status_order, expected_open = excluded.expected_open, geom = excluded.geom,
                     attrs = excluded.attrs, updated_at = now()""",
                (f"seed:{ln['line']}:{ln['segment']}:{st_name}", f"{ln['line']} {st_name}역", ln["line"], status,
                 INFRA_STATUS.index(status) + 1 if status in INFRA_STATUS else None, when, pt[0], pt[1], jsonb(attrs)),
            )
            stats["stations"] += 1
        if len(pts) >= 2:
            line = {"type": "LineString", "coordinates": [[p[0], p[1]] for p in pts]}
            conn.execute(
                """insert into infra_projects (source_key, kind, name, line_name, status, status_order, expected_open, geom, attrs, updated_at)
                   values (%s, 'rail', %s, %s, %s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, now())
                   on conflict (source_key) do update set status = excluded.status, status_order = excluded.status_order,
                     expected_open = excluded.expected_open, geom = excluded.geom, attrs = excluded.attrs, updated_at = now()""",
                (f"seed:{ln['line']}:{ln['segment']}", f"{ln['line']} {ln['segment']}", ln["line"], status,
                 INFRA_STATUS.index(status) + 1 if status in INFRA_STATUS else None, when, json.dumps(line),
                 jsonb({"seed": data["as_of"], "approx_line": True, "target_year": ln.get("target_year")})),
            )
        stats["lines"] += 1
        conn.commit()
    conn.execute(
        "insert into poi_fetches (key, fetched_at, count) values (%s, now(), %s) on conflict (key) do update set fetched_at = now(), count = excluded.count",
        (key, stats["stations"]),
    )
    conn.commit()
    return stats
