"""계획 도로(도시계획시설 도로 중 아직 다 만들지 않은 것) → infra_projects(kind='road').

출처: 브이월드 도시계획(도로) LT_C_UPISUQ151 — 지자체 도시계획정보체계(UPIS)의 결정·고시 도로. 집행 상태(exc_nam)가
미집행(EMA0002)·부분집행(EMA0003)이고 광로·대로·중로(폭 12m 이상)인 것만 받는다(소로는 골목 정비라 빼고, 집행완료는 이미 있는 도로).
'도로 건설 예정'에 해당하는 공개 자료 가운데 위치·등급·고시 번호가 함께 있는 것이다. 개통 목표 시기는 없다.

부하: 실거래를 모으는 지역(읍면동 중심)을 덮는 0.1° 격자만, 격자마다 60일에 한 번(poi_fetches 에 기록), 한 번 실행에 최대 12칸.
도시계획 결정·고시는 자주 바뀌지 않는다.
"""

from __future__ import annotations

import json
import logging

import httpx

from .. import http
from ..config import settings
from .zone_common import VWORLD_DATA, _vworld_params

log = logging.getLogger(__name__)

LAYER = "LT_C_UPISUQ151"
TILE = 0.1
MAX_AGE_DAYS = 60
FILTER = "excut_se:IN:EMA0002,EMA0003|grad_se:IN:광로,대로,중로"
STATUS = {"EMA0002": ("미집행", 1), "EMA0003": ("부분집행", 4)}


def tiles(conn) -> list[tuple[float, float]]:
    """실거래를 모으는 읍면동 중심과 관심 부동산이 있는 격자(가까운 곳부터가 아니라 격자 좌표 순)."""
    rows = conn.execute(
        f"""select distinct floor(ST_X(g) / {TILE}) as x, floor(ST_Y(g) / {TILE}) as y from (
              select center as g from regions where level = 3 and center is not null
              union all select geom from watch_items where geom is not null
            ) p order by 1, 2"""
    ).fetchall()
    return [(r["x"] * TILE, r["y"] * TILE) for r in rows]


def fetch_tile(x: float, y: float, conn=None) -> list[dict]:
    feats: list[dict] = []
    for page in range(1, 6):
        http.count_call(conn, f"vworld:{LAYER}")
        params = _vworld_params(service="data", request="GetFeature", data=LAYER, size="1000", page=str(page),
                                geometry="true", attribute="true", attrFilter=FILTER,
                                geomFilter=f"BOX({x:.4f},{y:.4f},{x + TILE:.4f},{y + TILE:.4f})")
        resp = http.get(VWORLD_DATA, params=params).json().get("response", {})
        if resp.get("status") == "NOT_FOUND":
            break
        if resp.get("status") != "OK":
            raise ValueError(f"vworld {resp.get('status')}: {(resp.get('error') or {}).get('text')}")
        feats += resp["result"]["featureCollection"]["features"]
        if page >= int(resp.get("page", {}).get("total", 1)):
            break
    return feats


def road_name(p: dict) -> str:
    """'대로1-1' · '중로3류(폭 12m~15m)' → 기능(주간선도로 등)을 붙인 이름."""
    base = (p.get("dgm_nm") or p.get("atr_nam") or "계획 도로").split("/")[0].strip()
    func = p.get("pmi_nam") or ""
    return f"{base} · {func}" if func and func not in base else base


def notice_date(ntfc_sn: str | None) -> str | None:
    """고시 번호(41460NTC202212230001)의 날짜 부분 → 2022-12-23."""
    if not ntfc_sn or "NTC" not in ntfc_sn:
        return None
    d = ntfc_sn.split("NTC", 1)[1][:8]
    return f"{d[:4]}-{d[4:6]}-{d[6:8]}" if d.isdigit() and len(d) == 8 else None


def save(conn, feats: list[dict], tile_key: str) -> int:
    n = 0
    for f in feats:
        p = f.get("properties") or {}
        g = f.get("geometry")
        sn = p.get("present_sn")
        if not g or not sn:
            continue
        status, order = STATUS.get(p.get("excut_se") or "", (p.get("exc_nam") or "계획", 1))
        attrs = {
            "source": "upis",
            "tile": tile_key,
            "grade": p.get("grad_se"),
            "function": p.get("pmi_nam"),
            "length_m": p.get("dgm_lt"),
            "area_m2": p.get("dgm_ar"),
            "sgg_cd": p.get("signgu_se"),
            "notice": p.get("ntfc_sn"),
            "notice_date": notice_date(p.get("ntfc_sn")),
        }
        conn.execute(
            """insert into infra_projects (source_key, kind, name, line_name, status, status_order, geom, attrs, updated_at)
               values (%s, 'road', %s, %s, %s, %s,
                 ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 0.00001)), 3)),
                 %s::jsonb, now())
               on conflict (source_key) do update set name = excluded.name, line_name = excluded.line_name, status = excluded.status,
                 status_order = excluded.status_order, geom = excluded.geom, attrs = excluded.attrs, updated_at = now()""",
            (f"upis-road:{sn}", road_name(p), p.get("grad_se"), status, order, json.dumps(g), json.dumps(attrs, ensure_ascii=False)),
        )
        n += 1
    return n


def collect_planned_roads(conn, max_tiles: int = 12) -> dict:
    if not settings.vworld_key:
        return {"skipped": "VWORLD_KEY"}
    stats = {"tiles": 0, "fetched": 0, "roads": 0, "removed": 0, "errors": 0}
    for x, y in tiles(conn):
        if stats["fetched"] >= max_tiles:
            break
        key = f"uq151:{x:.1f}:{y:.1f}"
        fresh = conn.execute(
            "select fetched_at > now() - make_interval(days => %s) as ok from poi_fetches where key = %s", (MAX_AGE_DAYS, key)
        ).fetchone()
        stats["tiles"] += 1
        if fresh and fresh["ok"]:
            continue
        try:
            feats = fetch_tile(x, y, conn)
        except (httpx.HTTPError, ValueError, KeyError) as e:
            log.warning("계획 도로 %s 실패: %s", key, e)
            stats["errors"] += 1
            if stats["errors"] >= 3:
                break  # 키·차단 문제면 다음 실행에
            continue
        stats["roads"] += save(conn, feats, key)
        # 이 격자에서 이번에 보이지 않은 도로(집행 완료·결정 취소)는 지운다
        stats["removed"] += conn.execute(
            """delete from infra_projects where kind = 'road' and attrs->>'source' = 'upis' and attrs->>'tile' = %s
                 and updated_at < now() - interval '1 hour'""",
            (key,),
        ).rowcount
        conn.execute(
            """insert into poi_fetches (key, fetched_at, count) values (%s, now(), %s)
               on conflict (key) do update set fetched_at = now(), count = excluded.count""",
            (key, len(feats)),
        )
        conn.commit()
        stats["fetched"] += 1
    return stats
