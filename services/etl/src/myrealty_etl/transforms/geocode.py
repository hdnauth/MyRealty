"""주소 → 좌표. 네이버 클라우드(NCP) Geocoding 우선, 브이월드 보조. 결과는 geocode_cache 에 저장."""

from __future__ import annotations

import logging

import httpx

from .. import http
from ..config import settings

log = logging.getLogger(__name__)

NCP_GEOCODE = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"
VWORLD_ADDRESS = "https://api.vworld.kr/req/address"


def _naver(query: str) -> tuple[float, float] | None:
    if not (settings.ncp_key_id and settings.ncp_key):
        return None
    r = http.get(NCP_GEOCODE, params={"query": query},
                 headers={"x-ncp-apigw-api-key-id": settings.ncp_key_id, "x-ncp-apigw-api-key": settings.ncp_key})
    addrs = r.json().get("addresses") or []
    if not addrs:
        return None
    return float(addrs[0]["x"]), float(addrs[0]["y"])


def _vworld(query: str, kind: str = "PARCEL") -> tuple[float, float] | None:
    if not settings.vworld_key:
        return None
    params = {"service": "address", "request": "getcoord", "version": "2.0", "crs": "epsg:4326",
              "address": query, "refine": "true", "simple": "false", "format": "json", "type": kind,
              "key": settings.vworld_key}
    if settings.vworld_domain:
        params["domain"] = settings.vworld_domain
    r = http.get(VWORLD_ADDRESS, params=params)
    resp = r.json().get("response", {})
    if resp.get("status") != "OK":
        return None
    p = resp["result"]["point"]
    return float(p["x"]), float(p["y"])


def geocode(conn, query: str) -> tuple[float, float] | None:
    query = " ".join(query.split())
    if not query:
        return None
    hit = conn.execute("select lng, lat from geocode_cache where query = %s", (query,)).fetchone()
    if hit:
        return (hit["lng"], hit["lat"]) if hit["lng"] is not None else None
    result, provider = None, None
    for name, fn in (("naver", _naver), ("vworld", _vworld)):
        try:
            result = fn(query)
        except (httpx.HTTPError, KeyError, ValueError) as e:
            log.warning("geocode %s 실패: %s", name, e)
            continue
        if result:
            provider = name
            break
    if provider is None and not (settings.ncp_key_id or settings.vworld_key):
        return None  # 키가 없으면 캐시에 실패를 기록하지 않는다
    conn.execute(
        "insert into geocode_cache (query, lng, lat, provider) values (%s, %s, %s, %s) on conflict (query) do nothing",
        (query, result[0] if result else None, result[1] if result else None, provider),
    )
    conn.commit()
    return result


def geocode_pending(conn, limit: int = 300) -> dict:
    """좌표가 없는 단지·읍면동을 지오코딩하고, 거래 행에 좌표를 전파한다."""
    stats = {"complexes": 0, "regions": 0}
    rows = conn.execute(
        """select c.id, c.umd_nm, c.jibun, c.name, coalesce(t.name, r.sido || ' ' || r.sigungu, '') as sgg_name
           from complexes c
           left join collect_targets t on t.sgg_cd = c.sgg_cd
           left join regions r on r.lawd_cd = rpad(c.sgg_cd, 10, '0')
           where c.geom is null
           limit %s""",
        (limit,),
    ).fetchall()
    for c in rows:
        pt = None
        if c["jibun"]:
            pt = geocode(conn, f"{c['sgg_name']} {c['umd_nm'] or ''} {c['jibun']}")
        if pt is None and c["name"]:
            pt = geocode(conn, f"{c['sgg_name']} {c['umd_nm'] or ''} {c['name']}")
        if pt:
            conn.execute("update complexes set geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326) where id = %s",
                         (pt[0], pt[1], c["id"]))
            stats["complexes"] += 1
    regs = conn.execute(
        """select r.lawd_cd, coalesce(t.name, r.sido || ' ' || r.sigungu, '') as sgg_name, r.emd
           from regions r left join collect_targets t on t.sgg_cd = substr(r.lawd_cd, 1, 5)
           where r.level = 3 and r.center is null limit %s""",
        (limit,),
    ).fetchall()
    for r in regs:
        pt = geocode(conn, f"{r['sgg_name']} {r['emd']}")
        if pt:
            conn.execute("update regions set center = ST_SetSRID(ST_MakePoint(%s, %s), 4326) where lawd_cd = %s",
                         (pt[0], pt[1], r["lawd_cd"]))
            stats["regions"] += 1
    conn.commit()
    stats["tx_updated"] = propagate_tx_geom(conn)
    return stats


def propagate_tx_geom(conn) -> int:
    n = 0
    n += conn.execute(
        """update transactions t set lawd_cd = r.lawd_cd
           from regions r
           where t.lawd_cd is null and r.level = 3 and substr(r.lawd_cd, 1, 5) = t.sgg_cd and r.emd = t.umd_nm"""
    ).rowcount
    n += conn.execute(
        """update transactions t set geom = c.geom from complexes c
           where t.complex_id = c.id and t.geom is null and c.geom is not null"""
    ).rowcount
    n += conn.execute(
        """update transactions t set geom = r.center from regions r
           where t.geom is null and t.complex_id is null and r.lawd_cd = t.lawd_cd and r.center is not null"""
    ).rowcount
    conn.commit()
    return n
