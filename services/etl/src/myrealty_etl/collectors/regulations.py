"""규제·계획 구역 경계(브이월드 LT_C_UQ141 용도구역) → regulation_areas.

토지거래계약에관한허가구역(토허제)과 지구단위계획구역. 전국을 다 받지 않고 관심 부동산·진행 중 정비구역이 있는
0.1° 격자만, 격자마다 25일에 한 번(poi_fetches 에 기록) 받는다.
"""

from __future__ import annotations

import hashlib
import json
import logging

import httpx

from .. import http
from ..config import settings
from .zone_common import VWORLD_DATA, _vworld_params

log = logging.getLogger(__name__)

KINDS = {"토지거래계약에관한허가구역": "permit", "지구단위계획구역": "district_plan"}
TILE = 0.1


def tiles(conn) -> list[tuple[float, float]]:
    rows = conn.execute(
        f"""select distinct floor(ST_X(g) / {TILE}) as x, floor(ST_Y(g) / {TILE}) as y from (
              select geom as g from watch_items where geom is not null
              union all select ST_PointOnSurface(geom) from redevelopment_zones where geom is not null and stage_order is distinct from 9
            ) p"""
    ).fetchall()
    return [(r["x"] * TILE, r["y"] * TILE) for r in rows]


def fetch_tile(uname: str, x: float, y: float) -> list[dict]:
    out, page = [], 1
    while True:
        params = _vworld_params(service="data", request="GetFeature", data="LT_C_UQ141", attrFilter=f"uname:=:{uname}",
                                geomFilter=f"BOX({x:.4f},{y:.4f},{x + TILE:.4f},{y + TILE:.4f})",
                                geometry="true", attribute="true", size="1000", page=str(page))
        resp = http.get(VWORLD_DATA, params=params).json().get("response", {})
        if resp.get("status") == "NOT_FOUND":
            break
        if resp.get("status") != "OK":
            raise ValueError(f"vworld UQ141 {resp.get('status')}: {(resp.get('error') or {}).get('text')}")
        out += (resp.get("result") or {}).get("featureCollection", {}).get("features", [])
        total = int((resp.get("page") or {}).get("total") or 1)
        if page >= total:
            break
        page += 1
    return out


def save(conn, uname: str, feats: list[dict]) -> int:
    n = 0
    for f in feats:
        p = f.get("properties") or {}
        g = f.get("geometry")
        if not g:
            continue
        # 응답의 피처 id(LT_C_UQ141.579)는 요청마다 바뀌는 일련번호라 키로 못 쓴다 — 고시 정보 + 형상 해시
        shape = hashlib.sha1(json.dumps(g, sort_keys=True).encode()).hexdigest()[:16]
        fid = f"{p.get('sido_name')}:{p.get('sigg_name')}:{p.get('dyear')}:{p.get('dnum')}:{shape}"
        conn.execute(
            """insert into regulation_areas (source_key, kind, name, sido, sgg_name, dyear, geom, attrs, updated_at)
               values (%s, %s, %s, %s, %s, %s, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)),
                 %s::jsonb, now())
               on conflict (source_key) do update set geom = excluded.geom, dyear = excluded.dyear, attrs = excluded.attrs,
                 updated_at = now()""",
            (f"uq141:{fid}", KINDS[uname], uname, p.get("sido_name"), p.get("sigg_name"), p.get("dyear"), json.dumps(g),
             json.dumps({k: v for k, v in p.items() if k not in ("uname",)}, ensure_ascii=False)),
        )
        n += 1
    return n


def collect_regulations(conn, max_tiles: int = 400) -> dict:
    if not settings.vworld_key:
        return {"skipped": "VWORLD_KEY"}
    stats = {"tiles": 0, "fetched": 0, "areas": 0, "errors": 0}
    for x, y in tiles(conn)[:max_tiles]:
        for uname in KINDS:
            key = f"uq141:{KINDS[uname]}:{x:.1f}:{y:.1f}"
            fresh = conn.execute("select fetched_at > now() - interval '25 days' as ok from poi_fetches where key = %s", (key,)).fetchone()
            if fresh and fresh["ok"]:
                continue
            try:
                feats = fetch_tile(uname, x, y)
            except (httpx.HTTPError, ValueError) as e:
                log.warning("규제 구역 %s 실패: %s", key, e)
                stats["errors"] += 1
                continue
            stats["areas"] += save(conn, uname, feats)
            conn.execute(
                """insert into poi_fetches (key, fetched_at, count) values (%s, now(), %s)
                   on conflict (key) do update set fetched_at = now(), count = excluded.count""",
                (key, len(feats)),
            )
            conn.commit()
            stats["fetched"] += 1
        stats["tiles"] += 1
    # 한동안 어느 격자에서도 다시 보이지 않은(해제된) 구역 정리
    stats["removed"] = conn.execute("delete from regulation_areas where updated_at < now() - interval '75 days'").rowcount
    conn.commit()
    return stats

