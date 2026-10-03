"""주소 → 좌표. 네이버 클라우드(NCP) Geocoding 우선, 브이월드 보조. 결과는 geocode_cache 에 저장."""

from __future__ import annotations

import logging
import re

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
    if resp.get("status") == "NOT_FOUND":
        return None
    if resp.get("status") != "OK":
        # 키·도메인 오류는 '결과 없음'과 구분(실패를 캐시하지 않게)
        raise ValueError(f"vworld {resp.get('status')}: {(resp.get('error') or {}).get('code')}")
    p = resp["result"]["point"]
    return float(p["x"]), float(p["y"])


def geocode(conn, query: str, *, retry_negative: bool = False) -> tuple[float, float] | None:
    """retry_negative: 캐시된 '좌표 없음'도 다시 시도(관심 부동산 좌표처럼 꼭 필요한 경우).
    '좌표 없음' 캐시는 3일이 지나면 저절로 다시 시도한다. 호출 오류(키·차단)로 실패하면 캐시하지 않는다."""
    query = " ".join(query.split())
    if not query:
        return None
    hit = conn.execute(
        "select lng, lat, (lng is null and fetched_at < now() - interval '3 days') as stale from geocode_cache where query = %s",
        (query,),
    ).fetchone()
    if hit and hit["lng"] is not None:
        return hit["lng"], hit["lat"]
    if hit and not (retry_negative or hit["stale"]):
        return None
    result, provider, errors = None, None, 0
    for name, fn in (("naver", _naver), ("vworld", _vworld)):
        try:
            result = fn(query)
        except (httpx.HTTPError, KeyError, ValueError) as e:
            log.warning("geocode %s 실패: %s", name, e)
            errors += 1
            continue
        if result:
            provider = name
            break
    if provider is None and (errors or not (settings.ncp_key_id or settings.vworld_key)):
        return None  # 키가 없거나 호출 오류면 실패를 캐시하지 않는다
    conn.execute(
        """insert into geocode_cache (query, lng, lat, provider) values (%s, %s, %s, %s)
           on conflict (query) do update set lng = excluded.lng, lat = excluded.lat, provider = excluded.provider, fetched_at = now()""",
        (query, result[0] if result else None, result[1] if result else None, provider),
    )
    conn.commit()
    return result


def geocode_pending(conn, limit: int = 300, sgg_cd: str | None = None, lawd_cd: str | None = None) -> dict:
    """좌표가 없는 단지·읍면동을 지오코딩하고, 거래 행에 좌표를 전파한다.
    sgg_cd 를 주면 그 시군구만, lawd_cd(읍면동)가 같은 단지부터(개별 수집에서 내 동네를 먼저)."""
    stats = {"complexes": 0, "regions": 0}
    rows = conn.execute(
        """select c.id, c.umd_nm, c.jibun, c.name, coalesce(t.name, r.sido || ' ' || r.sigungu, '') as sgg_name
           from complexes c
           left join collect_targets t on t.sgg_cd = c.sgg_cd
           left join regions r on r.lawd_cd = rpad(c.sgg_cd, 10, '0')
           where c.geom is null and (%(sgg)s::text is null or c.sgg_cd = %(sgg)s)
           order by (c.lawd_cd is not distinct from %(lawd)s) desc, c.id
           limit %(limit)s""",
        {"sgg": sgg_cd, "lawd": lawd_cd, "limit": limit},
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
    # 읍면동 경계(브이월드): 코드 없는 토지·단독·상가 거래의 동네 코드, 좌표 없는 읍면동의 중심을 먼저 채운다
    from .regions import fill_regions

    stats.update(fill_regions(conn, sgg_cd=sgg_cd, limit=limit))
    regs = conn.execute(
        """select r.lawd_cd, coalesce(t.name, r.sido || ' ' || r.sigungu, '') as sgg_name, r.emd
           from regions r left join collect_targets t on t.sgg_cd = substr(r.lawd_cd, 1, 5)
           where r.level = 3 and r.center is null and (%(sgg)s::text is null or substr(r.lawd_cd, 1, 5) = %(sgg)s)
           limit %(limit)s""",
        {"sgg": sgg_cd, "limit": limit},
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


def ensure_item_geom(conn, item_id: str) -> str | None:
    """관심 부동산 좌표가 없으면 채운다: 단지 좌표 → 주소 지오코딩(네이버·브이월드) → 읍면동 중심.
    등록 때 웹 지오코딩이 실패했어도(키·일시 오류) 여기서 다시 시도한다. 채운 방법을 돌려준다."""
    w = conn.execute(
        """select w.id, w.geom is not null as has, w.road_address, w.jibun_address, w.lawd_cd,
                  ST_X(c.geom) as clng, ST_Y(c.geom) as clat
           from watch_items w left join complexes c on c.id = w.complex_id where w.id = %s""",
        (item_id,),
    ).fetchone()
    if not w or w["has"]:
        return None
    pt, how = None, None
    if w["clng"] is not None:
        pt, how = (w["clng"], w["clat"]), "complex"
    if pt is None:
        qs = [w["road_address"], w["jibun_address"]]
        if w["jibun_address"]:
            qs.append(re.sub(r"산\s+(\d)", r"산\1", w["jibun_address"]))
        for q in dict.fromkeys(x for x in qs if x):
            pt = geocode(conn, q, retry_negative=True)
            if pt:
                how = "geocode"
                break
    if pt is None and w["lawd_cd"]:
        r = conn.execute("select ST_X(center) as lng, ST_Y(center) as lat from regions where lawd_cd = %s and center is not null",
                         (w["lawd_cd"],)).fetchone()
        if r:
            pt, how = (r["lng"], r["lat"]), "region_center"
    if pt is None:
        return None
    conn.execute("update watch_items set geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326), updated_at = now() where id = %s",
                 (pt[0], pt[1], item_id))
    conn.commit()
    return how


def geocode_items(conn, limit: int = 50) -> dict:
    """좌표가 없는 관심 부동산을 모두 채운다(매일 파이프라인)."""
    ids = [r["id"] for r in conn.execute(
        "select id::text as id from watch_items where geom is null order by created_at desc limit %s", (limit,))]
    done: dict[str, int] = {}
    for i in ids:
        how = ensure_item_geom(conn, i)
        if how:
            done[how] = done.get(how, 0) + 1
    return {"missing": len(ids), **done}
