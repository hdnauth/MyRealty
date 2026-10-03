"""읍면동(법정동·법정리) 채우기: 브이월드 행정경계(LT_C_ADEMD_INFO 읍면동, LT_C_ADRI_INFO 리)에서 코드·경계·중심을 받는다.

실거래 중 토지·단독·상가 자료에는 법정동 코드가 없고 '대곶면 대능리' 같은 이름만 있다. 읍면동 목록(regions)은 코드를 주는
아파트 등 실거래에서만 만들어져, 아파트가 없는 리의 토지 거래는 동네에 연결되지 않아 지도·동네 시세에서 빠졌다
(김포·순천·광양 토지의 70% 이상). 이름으로 경계를 찾아 코드를 얻고, 같은 호출로 경계 폴리곤과 중심 좌표도 채운다.
주소 지오코딩으로 중심을 못 찾던 읍면동도 코드로 경계를 받아 채운다.
"""

from __future__ import annotations

import json
import logging

import httpx

from .. import http
from ..config import settings

log = logging.getLogger(__name__)

VWORLD_DATA = "https://api.vworld.kr/req/data"
# 실패(경계 없음)는 geocode_cache 에 좌표 없이 남겨 3일 동안 다시 묻지 않는다
CACHE_PREFIX = "boundary:"


def _features(layer: str, attr_filter: str, conn=None) -> list[dict]:
    if not settings.vworld_key:
        return []
    http.count_call(conn, f"vworld:{layer}")
    params = {"service": "data", "request": "GetFeature", "data": layer, "key": settings.vworld_key, "format": "json",
              "geometry": "true", "attribute": "true", "size": 20, "attrFilter": attr_filter}
    if settings.vworld_domain:
        params["domain"] = settings.vworld_domain
    resp = http.get(VWORLD_DATA, params=params).json().get("response", {})
    if resp.get("status") == "NOT_FOUND":
        return []
    if resp.get("status") != "OK":
        raise ValueError(f"vworld {resp.get('status')}: {(resp.get('error') or {}).get('code')}")
    return resp["result"]["featureCollection"]["features"]


def pick_feature(features: list[dict], sgg_cd: str, umd_nm: str | None = None) -> tuple[str, dict] | None:
    """같은 이름의 경계(전국에 '대능리'가 여럿) 중 이 시군구·이 읍면 이름에 맞는 것 → (법정동 코드 10자리, geometry)."""
    for f in features:
        p = f.get("properties") or {}
        code = p.get("li_cd") or (f"{p['emd_cd']}00" if p.get("emd_cd") else None)
        if not code or len(code) != 10 or not code.startswith(sgg_cd):
            continue
        # '통진읍 마송리'처럼 읍면이 붙은 이름이면 전체 이름 끝이 같아야 한다(같은 시군구에 같은 리 이름이 있을 수 있다)
        if umd_nm and not (p.get("full_nm") or "").replace(" ", "").endswith(umd_nm.replace(" ", "")):
            continue
        return code, f.get("geometry")
    return None


def _lookup_by_name(sgg_cd: str, umd_nm: str, conn) -> tuple[str, dict] | None:
    last = umd_nm.split()[-1]
    layer, field = ("LT_C_ADRI_INFO", "li_kor_nm") if last.endswith("리") else ("LT_C_ADEMD_INFO", "emd_kor_nm")
    return pick_feature(_features(layer, f"{field}:=:{last}", conn), sgg_cd, umd_nm)


def _lookup_by_code(lawd_cd: str, conn) -> tuple[str, dict] | None:
    if lawd_cd.endswith("00"):
        return pick_feature(_features("LT_C_ADEMD_INFO", f"emd_cd:=:{lawd_cd[:8]}", conn), lawd_cd[:5])
    return pick_feature(_features("LT_C_ADRI_INFO", f"li_cd:=:{lawd_cd}", conn), lawd_cd[:5])


def _cached_miss(conn, key: str) -> bool:
    r = conn.execute(
        "select 1 from geocode_cache where query = %s and lng is null and fetched_at > now() - interval '3 days'", (CACHE_PREFIX + key,)
    ).fetchone()
    return r is not None


def _remember_miss(conn, key: str) -> None:
    conn.execute(
        """insert into geocode_cache (query, lng, lat, provider) values (%s, null, null, 'vworld-boundary')
           on conflict (query) do update set lng = null, lat = null, fetched_at = now()""",
        (CACHE_PREFIX + key,),
    )


def _save(conn, lawd_cd: str, emd: str | None, geometry: dict | None) -> None:
    geo = json.dumps(geometry) if geometry else None
    conn.execute(
        """insert into regions (lawd_cd, emd, level, center, geom)
           values (%(code)s, %(emd)s, 3,
                   ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(%(geo)s), 4326)),
                   ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(geo)s), 4326)))
           on conflict (lawd_cd) do update set
             emd = coalesce(regions.emd, excluded.emd),
             center = coalesce(regions.center, excluded.center),
             geom = coalesce(regions.geom, excluded.geom)""",
        {"code": lawd_cd, "emd": emd, "geo": geo},
    )


def fill_regions(conn, sgg_cd: str | None = None, limit: int = 300) -> dict:
    """좌표 없는 읍면동의 중심·경계, 코드 없는 거래 동네의 코드를 채운다(이름 맞추기는 propagate_tx_geom 이 한다)."""
    stats = {"centers": 0, "named": 0, "missed": 0}
    if not settings.vworld_key:
        return stats
    # 1) 코드는 있는데 중심이 없는 읍면동
    for r in conn.execute(
        """select lawd_cd from regions where level = 3 and center is null
             and (%(sgg)s::text is null or substr(lawd_cd, 1, 5) = %(sgg)s) limit %(limit)s""",
        {"sgg": sgg_cd, "limit": limit},
    ).fetchall():
        code = r["lawd_cd"].strip()
        if _cached_miss(conn, code):
            continue
        try:
            hit = _lookup_by_code(code, conn)
        except (httpx.HTTPError, KeyError, ValueError) as e:
            log.warning("경계(코드 %s) 조회 실패: %s", code, e)
            break  # 키·차단 문제면 다음 실행에
        if hit and hit[1]:
            _save(conn, code, None, hit[1])
            stats["centers"] += 1
        else:
            _remember_miss(conn, code)
            stats["missed"] += 1
    # 2) 코드 없는 거래의 동네 이름(거래 많은 곳부터)
    for r in conn.execute(
        """select t.sgg_cd, t.umd_nm, count(*) as n from transactions t
           where t.lawd_cd is null and t.umd_nm is not null and t.umd_nm <> ''
             and (%(sgg)s::text is null or t.sgg_cd = %(sgg)s)
             and not exists (select 1 from regions r where r.level = 3 and substr(r.lawd_cd, 1, 5) = t.sgg_cd and r.emd = t.umd_nm)
           group by 1, 2 order by n desc limit %(limit)s""",
        {"sgg": sgg_cd, "limit": limit},
    ).fetchall():
        key = f"{r['sgg_cd']}:{r['umd_nm']}"
        if _cached_miss(conn, key):
            continue
        try:
            hit = _lookup_by_name(r["sgg_cd"], r["umd_nm"], conn)
        except (httpx.HTTPError, KeyError, ValueError) as e:
            log.warning("경계(%s) 조회 실패: %s", key, e)
            break
        if hit:
            # 이미 있는 코드(다른 이름으로 등록)면 이름은 그대로 두고 거래만 그 코드로 잇는다
            _save(conn, hit[0], r["umd_nm"], hit[1])
            conn.execute(
                "update transactions set lawd_cd = %s where lawd_cd is null and sgg_cd = %s and umd_nm = %s",
                (hit[0], r["sgg_cd"], r["umd_nm"]),
            )
            stats["named"] += 1
        else:
            _remember_miss(conn, key)
            stats["missed"] += 1
    conn.commit()
    return stats
