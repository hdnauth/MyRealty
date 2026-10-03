"""토지이용계획 필지(브이월드 NED getLandUseWFS) → 정비구역 경계 · 정비사업 후보지.

서울 밖은 정비구역 경계 자료(서울 의제처리구역 같은 파일)가 없고, 브이월드 2D 데이터 레이어에도 정비구역은 없다.
대신 토지이용계획 WFS 는 필지마다 테두리와 용도지역지구 목록을 함께 준다(한 번에 최대 1,000필지):
  - UDT100 정비구역(포함·저촉)                                 → zone
  - UDT999 정비구역기타(정비사업 후보지 행위제한지역,
           행위제한지역(건축행위 및 토지의 분할 제한지역))       → candidate  (구역 지정 전 — 공모·공람 단계)
  - UDK300 소규모주택정비사업의 사업시행구역                     → small
이 필지들을 이어 붙여(zone_shapes) ① 점으로만 있던 구역(경기·부산·인천·국토부 …)에 경계를 붙이고
② 어느 출처에도 없는 후보지(예: 수원 우만가·우만나구역 — 공람 중이라 시·도 시스템에 아직 없음)를 새 구역으로 만든다.

부하: 격자(0.004°, 약 440×360m)마다 한 번 호출하고 45일 동안 다시 받지 않는다(poi_fetches 'luz:<x>:<y>').
받을 격자: 수집 지역 단지가 있는 격자 · 관심 부동산 주변 3×3 · 경계 없는 구역 점의 격자. 받은 구역 필지가 격자 끝에 닿으면
옆 격자를 다음 차례로 둔다('luzq:<x>:<y>', 구역이 격자 밖으로 이어질 때만 넓혀 받는다). 한 실행 최대 LANDUSE_MAX_TILES(150)·LANDUSE_MAX_MIN(8분).
"""

from __future__ import annotations

import json
import logging
import os
import re
import time

import httpx

from .. import http
from ..config import settings
from .zone_common import VWORLD_DATA, _vworld_params, upsert_record

log = logging.getLogger(__name__)

WFS = "https://api.vworld.kr/ned/wfs/getLandUseWFS"
TILE = 0.004
MAX_FEATURES = 1000
REFRESH_DAYS = 45
MAX_TILES = int(os.environ.get("LANDUSE_MAX_TILES") or 150)
# 매일 수집 시간 예산을 지키려고 격자 받기에 쓰는 시간 상한(분) — 넘으면 남은 격자는 다음 실행으로
MAX_MINUTES = float(os.environ.get("LANDUSE_MAX_MIN") or 8)
# 필지 사이 도로·틈(수 m)은 이어 붙인다(도로를 빼고 지정된 후보지도 한 덩어리로)
GAP = 0.00003
# 새 후보지로 만들 최소 면적(㎡) — 필지 한두 개짜리 조각은 뺀다
MIN_CANDIDATE_M2 = 3000
# 한 구역으로 보기엔 너무 큰 덩어리(뉴타운 전체 등)는 개별 구역 경계로 붙이지 않는다
MAX_ZONE_M2 = 600_000


def classify(props: dict) -> dict[str, str]:
    """필지 속성 → {code: 원천 이름}. 이름 목록은 이름 안의 쉼표 때문에 코드 목록과 순서가 어긋날 수 있어
    코드·포함 여부는 같은 순번으로, 이름은 해당 말이 들어간 것을 찾아 쓴다."""
    codes = [c.strip() for c in (props.get("prpos_area_dstrc_code_list") or "").split(",")]
    hits = [c.strip() for c in (props.get("cnflc_at_nm_list") or "").split(",")]
    names = props.get("prpos_area_dstrc_nm_list") or ""
    out: dict[str, str] = {}
    for i, code in enumerate(codes):
        if (hits[i] if i < len(hits) else "") not in ("포함", "저촉"):
            continue
        if code == "UDT100":
            out.setdefault("zone", "정비구역")
        elif code == "UDT999":
            m = re.search(r"정비구역기타\((?:[^()]|\([^()]*\))*\)", names)
            label = m.group(0) if m else "정비구역기타"
            if "후보지" in label or "행위제한" in label:
                out.setdefault("candidate", label)
        elif code == "UDK300":
            out.setdefault("small", "소규모주택정비사업의 사업시행구역")
    return out


def jibun_of(props: dict) -> str | None:
    try:
        main, sub = int(props.get("mnnm") or 0), int(props.get("slno") or 0)
    except ValueError:
        return None
    if not main:
        return None
    s = f"{main}-{sub}" if sub else str(main)
    return f"산 {s}" if str(props.get("regstr_se_code")) == "2" else s


def fetch_box(x0: float, y0: float, x1: float, y1: float, depth: int = 0) -> list[dict]:
    """bbox 안 필지. 1,000개가 꽉 차면 넷으로 나눠 다시(최대 두 번)."""
    params = {"key": settings.vworld_key, "typename": "dt_d154", "bbox": f"{y0:.6f},{x0:.6f},{y1:.6f},{x1:.6f},EPSG:4326",
              "srsName": "EPSG:4326", "maxFeatures": str(MAX_FEATURES), "resultType": "results", "output": "application/json"}
    if settings.vworld_domain:
        params["domain"] = settings.vworld_domain
    r = http.get(WFS, params=params)
    try:
        feats = r.json().get("features") or []
    except ValueError:
        msg = re.search(r"<ServiceException[^>]*>([^<]+)<", r.text)
        raise ValueError(f"vworld 토지이용계획 WFS: {msg.group(1) if msg else r.text[:80]}") from None
    if len(feats) >= MAX_FEATURES and depth < 2:
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        out: dict[str, dict] = {}
        for bx in ((x0, y0, mx, my), (mx, y0, x1, my), (x0, my, mx, y1), (mx, my, x1, y1)):
            for f in fetch_box(*bx, depth=depth + 1):
                out[(f.get("properties") or {}).get("pnu") or f.get("id")] = f
        return list(out.values())
    return feats


def _bounds(geom: dict) -> tuple[float, float, float, float] | None:
    xs, ys = [], []

    def walk(c):
        if c and isinstance(c[0], (int, float)):
            xs.append(c[0])
            ys.append(c[1])
        else:
            for p in c or []:
                walk(p)

    walk(geom.get("coordinates"))
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def save_tile(conn, tx: int, ty: int, feats: list[dict]) -> dict:
    """한 격자 필지 저장(그 격자의 이전 필지는 바꾼다). 구역 필지가 격자 끝에 닿은 방향의 옆 격자를 돌려준다."""
    key = f"{tx}:{ty}"
    x0, y0 = tx * TILE, ty * TILE
    eps = TILE * 0.01
    conn.execute("delete from zone_parcels where tile = %s", (key,))
    n, edges = 0, set()
    for f in feats:
        p, g = f.get("properties") or {}, f.get("geometry")
        pnu = p.get("pnu")
        if not g or not pnu or len(pnu) != 19:
            continue
        cls = classify(p)
        if not cls:
            continue
        for code, label in cls.items():
            conn.execute(
                """insert into zone_parcels (pnu, code, label, jibun, tile, geom, updated_at)
                   values (%s, %s, %s, %s, %s, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)), now())
                   on conflict (pnu, code) do update set label = excluded.label, jibun = excluded.jibun, tile = excluded.tile,
                     geom = excluded.geom, updated_at = now()""",
                (pnu, code, label, jibun_of(p), key, json.dumps(g)),
            )
            n += 1
        b = _bounds(g)
        if b:
            if b[0] <= x0 + eps:
                edges.add((tx - 1, ty))
            if b[2] >= x0 + TILE - eps:
                edges.add((tx + 1, ty))
            if b[1] <= y0 + eps:
                edges.add((tx, ty - 1))
            if b[3] >= y0 + TILE - eps:
                edges.add((tx, ty + 1))
    return {"parcels": n, "edges": edges}


def pending_tiles(conn, limit: int) -> list[tuple[int, int]]:
    """받을 격자(가까운 우선순위부터). 45일 안에 받은 격자는 뺀다."""
    rows = conn.execute(
        f"""with pts as (
              select c.geom as g, 0 as pri, false as ring from complexes c
              where c.geom is not null and c.sgg_cd in (select sgg_cd from collect_targets where enabled)
              union all select geom, 0, true from watch_items where geom is not null
              union all select geom, 1, false from redevelopment_zones
              where geom is not null and GeometryType(geom) = 'POINT' and stage_order is distinct from 9
                and coalesce(attrs->>'geo', '') <> 'dong'
            ), t as (
              select floor(ST_X(g) / {TILE})::int + dx as tx, floor(ST_Y(g) / {TILE})::int + dy as ty, pri
              from pts, (values (-1), (0), (1)) a(dx), (values (-1), (0), (1)) b(dy)
              where ring or (dx = 0 and dy = 0)
              union all
              select split_part(key, ':', 2)::int, split_part(key, ':', 3)::int, 0 from poi_fetches where key like 'luzq:%%'
            )
            select tx, ty, min(pri) as pri from t
            where not exists (select 1 from poi_fetches f where f.key = 'luz:' || t.tx || ':' || t.ty
                                and f.fetched_at > now() - make_interval(days => %s))
            group by tx, ty
            order by min(pri), tx, ty
            limit %s""",
        (REFRESH_DAYS, limit),
    ).fetchall()
    return [(r["tx"], r["ty"]) for r in rows]


def fetch_tiles(conn, max_tiles: int = MAX_TILES) -> dict:
    stats = {"tiles": 0, "parcels": 0, "queued": 0, "errors": 0}
    fails = 0
    until = time.monotonic() + MAX_MINUTES * 60
    for tx, ty in pending_tiles(conn, max_tiles):
        if time.monotonic() >= until:
            stats["stopped"] = "시간 상한"
            break
        try:
            feats = fetch_box(tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE)
        except (httpx.HTTPError, ValueError) as e:
            log.warning("토지이용계획 격자 %s:%s 실패: %s", tx, ty, e)
            stats["errors"] += 1
            fails += 1
            if fails >= 5:  # 서비스 장애면 이번 실행은 그만(격자마다 기다리지 않게)
                stats["stopped"] = True
                break
            continue
        fails = 0
        res = save_tile(conn, tx, ty, feats)
        stats["tiles"] += 1
        stats["parcels"] += res["parcels"]
        conn.execute(
            """insert into poi_fetches (key, fetched_at, count) values (%s, now(), %s)
               on conflict (key) do update set fetched_at = now(), count = excluded.count""",
            (f"luz:{tx}:{ty}", res["parcels"]),
        )
        conn.execute("delete from poi_fetches where key = %s", (f"luzq:{tx}:{ty}",))
        for nx, ny in res["edges"]:
            q = conn.execute(
                """insert into poi_fetches (key, fetched_at, count)
                   select %s, now(), 0 where not exists (
                     select 1 from poi_fetches where key = %s and fetched_at > now() - make_interval(days => %s))
                   on conflict (key) do nothing""",
                (f"luzq:{nx}:{ny}", f"luz:{nx}:{ny}", REFRESH_DAYS),
            )
            stats["queued"] += q.rowcount
        conn.commit()
    return stats


def build_shapes(conn) -> int:
    """필지 → 덩어리(코드·시군구별, 몇 m 틈은 이어 붙임)."""
    conn.execute("delete from zone_shapes")
    n = conn.execute(
        f"""insert into zone_shapes (code, sgg_cd, parcels, area_m2, rep_pnu, geom)
            select code, sgg, n, ST_Area(g::geography), rep, ST_Multi(ST_CollectionExtract(ST_SimplifyPreserveTopology(g, 0.000005), 3))
            from (
              select code, left(min(pnu), 5) as sgg, count(*)::int as n, min(pnu) as rep,
                ST_MakeValid(ST_Buffer(ST_Union(ST_Buffer(geom, {GAP / 2})), -{GAP / 2})) as g
              from (
                select code, pnu, geom,
                  ST_ClusterDBSCAN(geom, eps := {GAP}, minpoints := 1) over (partition by code, left(pnu, 5)) as cid
                from zone_parcels
              ) c
              group by code, left(pnu, 5), cid
            ) u
            where not ST_IsEmpty(g) and ST_Area(g::geography) >= 500"""
    ).rowcount
    conn.commit()
    return n


def attach_shapes(conn) -> int:
    """점으로만 있는 구역(위치가 지번·단지·장소로 정확한 것)에 덩어리 경계를 붙인다. 원래 점은 attrs.pt 에 남겨
    덩어리가 커지면(옆 격자를 더 받으면) 다음 실행에서 다시 붙인다."""
    n = conn.execute(
        f"""with z as (
              select id, stage_order, kind,
                coalesce(case when attrs ? 'pt' then ST_SetSRID(ST_MakePoint((attrs->'pt'->>0)::float8, (attrs->'pt'->>1)::float8), 4326) end,
                         ST_PointOnSurface(geom)) as pt
              from redevelopment_zones
              where geom is not null and stage_order is distinct from 9
                and source_key not like 'seoul:%%' and source_key not like 'landuse:%%'
                and ((GeometryType(geom) = 'POINT' and coalesce(attrs->>'geo', '') in ('address', 'source', 'complex', 'place'))
                     or attrs->>'geo' = 'landuse')
            ), m as (
              select distinct on (z.id) z.id, z.pt, s.geom, s.area_m2, s.code, s.parcels
              from z join zone_shapes s on ST_DWithin(s.geom, z.pt, 0.0006) and s.area_m2 <= {MAX_ZONE_M2}
                and s.code = any(case when z.kind ~ '소규모|가로|자율' then array['small', 'zone']
                                      when coalesce(z.stage_order, 1) <= 2 then array['zone', 'candidate']
                                      else array['zone'] end)
              order by z.id, ST_Distance(s.geom, z.pt),
                (s.code = case when coalesce(z.stage_order, 1) <= 1 then 'candidate' else 'zone' end) desc
            )
            update redevelopment_zones r set geom = m.geom, area_m2 = coalesce(r.area_m2, round(m.area_m2)),
              attrs = r.attrs || jsonb_build_object('geo', 'landuse',
                'pt', coalesce(r.attrs->'pt', jsonb_build_array(ST_X(m.pt), ST_Y(m.pt))),
                'landuse', jsonb_build_object('code', m.code, 'parcels', m.parcels, 'area_m2', round(m.area_m2))),
              updated_at = now()
            from m where r.id = m.id and not ST_Equals(r.geom, m.geom)"""
    ).rowcount
    conn.commit()
    return n


def _emd(conn, lawd10: str) -> dict | None:
    """법정동 코드 → {sido, sgg, emd}. regions 에 없으면 브이월드 읍면동 경계로 받아 넣는다(다음부터는 DB)."""
    r = conn.execute("select sido, sigungu, emd from regions where lawd_cd = %s and emd is not null", (lawd10,)).fetchone()
    if r:
        return {"sido": r["sido"], "sgg": r["sigungu"], "emd": r["emd"]}
    if not settings.vworld_key:
        return None
    params = _vworld_params(service="data", request="GetFeature", data="LT_C_ADEMD_INFO", attrFilter=f"emd_cd:=:{lawd10[:8]}",
                            geometry="true", attribute="true", size="1")
    try:
        resp = http.get(VWORLD_DATA, params=params).json().get("response", {})
    except (httpx.HTTPError, ValueError) as e:
        log.warning("읍면동 조회 실패 %s: %s", lawd10, e)
        return None
    feats = ((resp.get("result") or {}).get("featureCollection") or {}).get("features") or []
    if not feats:
        return None
    p = feats[0].get("properties") or {}
    parts = (p.get("full_nm") or "").split()
    out = {"sido": parts[0] if parts else None, "sgg": " ".join(parts[1:-1]) or None, "emd": p.get("emd_kor_nm") or (parts[-1] if parts else None)}
    conn.execute(
        """insert into regions (lawd_cd, sido, sigungu, emd, level, geom, center)
           values (%s, %s, %s, %s, 3, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)),
                   ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)))
           on conflict (lawd_cd) do update set emd = coalesce(regions.emd, excluded.emd), sido = coalesce(regions.sido, excluded.sido),
             sigungu = coalesce(regions.sigungu, excluded.sigungu), geom = coalesce(regions.geom, excluded.geom),
             center = coalesce(regions.center, excluded.center)""",
        (lawd10, out["sido"], out["sgg"], out["emd"], json.dumps(feats[0]["geometry"]), json.dumps(feats[0]["geometry"])),
    )
    return out


def candidate_stage(label: str | None) -> str:
    return "행위제한(구역 지정 전)" if label and "건축행위" in label else "정비사업 후보지(행위제한)"


def sync_candidates(conn) -> dict:
    """어느 출처에도 없는 후보지 덩어리 → 새 구역(source 'landuse'). 이미 만든 후보지는 덩어리가 커져도 같은 구역으로 이어 쓰고,
    다른 출처 구역과 겹치게 되면(시·도 시스템에 올라옴) 후보지는 숨긴다. 덩어리가 사라지면(행위제한 해제·탈락) 해제로 바꾼다."""
    stats = {"new": 0, "same": 0, "merged": 0, "released": 0}
    shapes = conn.execute(
        """select s.id, s.code, s.sgg_cd, s.parcels, round(s.area_m2)::int as area_m2, s.rep_pnu,
             ST_X(ST_PointOnSurface(s.geom)) as lng, ST_Y(ST_PointOnSurface(s.geom)) as lat,
             (select p.jibun from zone_parcels p where p.pnu = s.rep_pnu and p.code = s.code) as jibun,
             (select p.label from zone_parcels p where p.pnu = s.rep_pnu and p.code = s.code) as label,
             array(select z.id from redevelopment_zones z where z.source_key like 'landuse:%%' and z.stage_order is distinct from 9
                     and ST_Intersects(z.geom, s.geom) order by z.id) as own,
             -- 동 중심 점(위치가 대략)인 구역은 같은 곳인지 알 수 없어 세지 않는다
             exists (select 1 from redevelopment_zones z where z.source_key not like 'landuse:%%' and z.stage_order is distinct from 9
                       and z.geom is not null and coalesce(z.attrs->>'geo', '') <> 'dong' and ST_Intersects(z.geom, s.geom)) as taken
           from zone_shapes s where s.code = 'candidate' and s.area_m2 >= %s""",
        (MIN_CANDIDATE_M2,),
    ).fetchall()
    seen: set[int] = set()
    for s in shapes:
        own = list(s["own"] or [])
        if s["taken"]:
            for zid in own:
                _retire(conn, zid, "출처 구역과 같은 곳", merged=True)
                stats["merged"] += 1
            continue
        if own:
            keep, extra = own[0], own[1:]
            for zid in extra:
                _retire(conn, zid, "옆 후보지와 합침", merged=True)
                stats["merged"] += 1
            conn.execute(
                """update redevelopment_zones set geom = s.geom, area_m2 = round(s.area_m2),
                     attrs = attrs || jsonb_build_object('landuse', jsonb_build_object('code', s.code, 'parcels', s.parcels, 'area_m2', round(s.area_m2))),
                     updated_at = now()
                   from zone_shapes s where s.id = %s and redevelopment_zones.id = %s and not ST_Equals(redevelopment_zones.geom, s.geom)""",
                (s["id"], keep),
            )
            seen.add(keep)
            stats["same"] += 1
            continue
        emd = _emd(conn, s["rep_pnu"][:10]) or {}
        place = " ".join(x for x in (emd.get("emd"), s["jibun"]) if x)
        rec = {"source": "landuse", "source_id": f"{s['code']}:{s['rep_pnu']}", "sido": emd.get("sido"), "sgg_name": emd.get("sgg"),
               "name": f"{place} 일대" if place else "정비사업 후보지", "kind": "재개발", "stage": candidate_stage(s["label"]),
               "lng": s["lng"], "lat": s["lat"], "geo": "landuse", "sgg_cd": s["sgg_cd"], "area_m2": s["area_m2"],
               "address": " ".join(x for x in (emd.get("sido"), emd.get("sgg"), place) if x) or None,
               "attrs": {"candidate": True, "landuse": {"code": s["code"], "parcels": s["parcels"], "area_m2": s["area_m2"]},
                         "label": s["label"]}}
        upsert_record(conn, rec, find_location=False)
        z = conn.execute(
            """update redevelopment_zones set geom = s.geom from zone_shapes s
               where s.id = %s and redevelopment_zones.source_key = %s returning redevelopment_zones.id""",
            (s["id"], f"landuse:{rec['source_id']}"),
        ).fetchone()
        if z:
            seen.add(z["id"])
        stats["new"] += 1
        conn.commit()
    # 덩어리가 없어진 후보지(그 자리 격자를 구역 확인 뒤에 다시 받았는데 지정이 빠짐 — 행위제한 해제·탈락) → 해제
    gone = conn.execute(
        f"""select z.id from redevelopment_zones z
           where z.source_key like 'landuse:%%' and z.stage_order is distinct from 9
             and not exists (select 1 from zone_shapes s where s.code = 'candidate' and ST_Intersects(s.geom, z.geom))
             and exists (select 1 from poi_fetches f
                         where f.key = 'luz:' || floor(ST_X(ST_PointOnSurface(z.geom)) / {TILE})::int || ':' || floor(ST_Y(ST_PointOnSurface(z.geom)) / {TILE})::int
                           and f.fetched_at > z.updated_at)"""
    ).fetchall()
    for r in gone:
        if r["id"] not in seen:
            _retire(conn, r["id"], "후보지 해제")
            stats["released"] += 1
    conn.commit()
    return stats


def _retire(conn, zone_id: int, reason: str, merged: bool = False) -> None:
    """후보지 숨기기. 다른 구역과 합친 것은 단계 이력(알림)을 남기지 않고, 해제는 남긴다."""
    prev = conn.execute("select stage, stage_order from redevelopment_zones where id = %s", (zone_id,)).fetchone()
    if not prev or prev["stage_order"] == 9:
        return
    stage = reason if merged else "해제"
    conn.execute(
        """update redevelopment_zones set stage = %s, stage_order = 9, stage_date = current_date,
             attrs = attrs || jsonb_build_object('canceled', true, 'merged', %s::boolean, 'retired', %s::text), updated_at = now()
           where id = %s""",
        (stage, merged, reason, zone_id),
    )
    if not merged:
        conn.execute(
            "insert into zone_stage_history (zone_id, stage, stage_order, prev_stage, prev_order) values (%s, %s, 9, %s, %s)",
            (zone_id, stage, prev["stage"], prev["stage_order"]),
        )


# '우만가구역' · '우만(가)구역' · '송죽2구역' (가나다 순번 또는 숫자)
_NEWS_ZONE = re.compile(r"([가-힣]{1,8}?)\s?\(?([가나다라마바사아자차카타파하]|\d{1,2})\)?\s?구역")
_NEWS_LOT = re.compile(r"([가-힣]{1,6}[동리])\s*(\d{1,5}(?:-\d{1,4})?)\s*(?:번지)?\s*(?:일원|일대|일원에|외)")


def name_from_news(conn) -> int:
    """이름 없는 후보지에 뉴스 속 구역 이름을 붙인다: 같은 기사에 '○○가구역'과 '○○동 503-7 일대'가 함께 나오고
    그 지번이 후보지 안이면 그 이름으로. 지번 위치는 지오코딩 캐시를 쓴다(기사 수가 적어 호출이 적다)."""
    from ..transforms.geocode import geocode

    rows = conn.execute(
        """select z.id, z.sgg_cd, z.attrs->>'sido' as sido, z.attrs->>'gu' as gu, z.name
           from redevelopment_zones z
           where z.source_key like 'landuse:%%' and z.stage_order is distinct from 9 and not coalesce((z.attrs->>'named')::boolean, false)"""
    ).fetchall()
    if not rows:
        return 0
    arts = conn.execute(
        """select title || ' ' || coalesce(description, '') as text from articles
           where published_at > now() - interval '2 years' and (title || coalesce(description, '')) ~ '구역'"""
    ).fetchall()
    named = 0
    for a in arts:
        text = re.sub(r"<[^>]+>", " ", a["text"])
        zones = sorted({a + b + "구역" for a, b in _NEWS_ZONE.findall(text)})
        lots = _NEWS_LOT.findall(text)
        if len(zones) != 1 or not lots:
            continue  # 이름·지번이 하나로 짝지어지지 않는 기사는 쓰지 않는다
        zone_name = zones[0]
        for dong, lot in lots:
            for z in rows:
                if not z["gu"] or dong[:-1] not in z["name"]:
                    continue
                pt = geocode(conn, f"{z['sido'] or ''} {z['gu']} {dong} {lot}")
                if not pt:
                    continue
                hit = conn.execute(
                    """update redevelopment_zones set name = %s,
                         attrs = attrs || jsonb_build_object('named', true, 'place', %s::text), updated_at = now()
                       where id = %s and ST_Intersects(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326)) returning id""",
                    (zone_name, z["name"], z["id"], pt[0], pt[1]),
                ).fetchone()
                if hit:
                    named += 1
                    rows = [r for r in rows if r["id"] != z["id"]]
                    break
    conn.commit()
    return named


def collect_landuse_zones(conn, max_tiles: int = MAX_TILES) -> dict:
    if not settings.vworld_key:
        return {"skipped": "VWORLD_KEY"}
    stats = fetch_tiles(conn, max_tiles)
    stats["shapes"] = build_shapes(conn)
    stats["attached"] = attach_shapes(conn)
    stats.update({f"candidates_{k}": v for k, v in sync_candidates(conn).items()})
    try:
        stats["named"] = name_from_news(conn)
    except Exception as e:  # 이름 붙이기는 부가 기능 — 실패해도 경계·후보지는 남긴다
        conn.rollback()
        log.warning("후보지 이름 붙이기 실패: %s", e)
    # 단지 연결·단계 효과가 새 경계로 다시 계산되도록(zones_job 이 'located' 를 변경으로 센다)
    stats["located"] = stats["attached"] + stats["candidates_new"]
    return stats
