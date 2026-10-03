"""서울시 의제처리구역 위치정보(열린데이터광장 OA-20957, SHP, 연 2회) → 정비구역 경계(폴리곤).

정비구역·재정비촉진구역 등 도시계획 결정 구역의 경계와 결정고시 관리코드(WTNNC_SN)를 준다. 정보몽땅 사업장의
'지도' 코드(map_code)가 같은 코드라서 그 사업장의 점을 경계로 바꾼다. 코드가 없는 사업장은 점이 들어가는
가장 작은 정비 계열 구역(30만㎡ 이하)을 경계로 쓴다. 좌표계는 Bessel TM 중부(EPSG:5174 계열) → WGS84.
"""

from __future__ import annotations

import io
import json
import logging
import re
import zipfile

import httpx
import shapefile

log = logging.getLogger(__name__)

DATASET_PAGE = "https://data.seoul.go.kr/dataList/OA-20957/F/1/datasetView.do"
DOWNLOAD = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false"
# 한국 측지계(Bessel) 수정 중부원점 — 국내 좌표 변환 표준 7변수(towgs84) 포함
BESSEL_TM_CENTRAL = ("+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel "
                     "+units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43")
# 정비 계열 대분류(UQ12xx: 정비구역, UQ18xx: 재정비촉진) — 도시개발·공공주택지구 등은 제외
ZONE_CLASSES = ("UQ12", "UQ18")


def download_zip() -> bytes:
    with httpx.Client(timeout=120, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (MyRealty-ETL)"}) as c:
        page = c.get(DATASET_PAGE).text
        seqs = [int(s) for s in re.findall(r"downloadFile\('(\d+)'\)", page)]
        if not seqs:
            raise ValueError("의제처리구역 파일 목록을 찾지 못했습니다")
        r = c.post(DOWNLOAD, data={"infId": "OA-20957", "seqNo": "", "seq": str(max(seqs)), "infSeq": "1"})
        r.raise_for_status()
        if not r.content.startswith(b"PK"):
            raise ValueError("의제처리구역 파일이 zip 이 아닙니다")
        return r.content


def read_shapes(blob: bytes) -> list[dict]:
    """zip 안의 UPIS_C_UQ181.shp → [{present_sn, wtnnc_sn, name, atrb, sgg, geometry(GeoJSON)}] (정비 계열만)."""
    z = zipfile.ZipFile(io.BytesIO(blob))
    parts: dict[str, bytes] = {}
    for info in z.infolist():
        low = info.filename.lower()
        for ext in ("shp", "shx", "dbf"):
            if low.endswith("." + ext):
                parts[ext] = z.read(info)
    if not {"shp", "dbf"} <= parts.keys():
        raise ValueError("zip 에 shp/dbf 가 없습니다")
    reader = shapefile.Reader(shp=io.BytesIO(parts["shp"]), shx=io.BytesIO(parts["shx"]) if "shx" in parts else None,
                              dbf=io.BytesIO(parts["dbf"]), encoding="cp949")
    out = []
    for sr in reader.iterShapeRecords():
        rec = sr.record.as_dict()
        cls = str(rec.get("LCLAS_CL") or rec.get("ATRB_SE") or "")
        if not cls.startswith(ZONE_CLASSES) or sr.shape.shapeType == shapefile.NULL:
            continue
        out.append({"present_sn": rec.get("PRESENT_SN"), "wtnnc_sn": rec.get("WTNNC_SN") or None, "name": rec.get("DGM_NM"),
                    "atrb": rec.get("ATRB_SE"), "sgg": rec.get("SIGNGU_SE"), "geometry": sr.shape.__geo_interface__})
    return out


def save_boundaries(conn, shapes: list[dict]) -> int:
    conn.execute("create temporary table if not exists _zb (present_sn text, wtnnc_sn text, name text, atrb text, sgg text, g text) on commit drop")
    with conn.cursor().copy("copy _zb (present_sn, wtnnc_sn, name, atrb, sgg, g) from stdin") as cp:
        for s in shapes:
            cp.write_row((s["present_sn"], s["wtnnc_sn"], s["name"], s["atrb"], s["sgg"], json.dumps(s["geometry"])))
    conn.execute(
        """insert into zone_boundaries (present_sn, wtnnc_sn, name, atrb_se, sgg_cd, geom, area_m2, updated_at)
           select distinct on (present_sn) present_sn, wtnnc_sn, name, atrb, nullif(sgg, '11000'),
             ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(ST_GeomFromGeoJSON(g), %s, 4326)), 3)), null, now()
           from _zb where present_sn is not null
           order by present_sn
           on conflict (present_sn) do update set wtnnc_sn = excluded.wtnnc_sn, name = excluded.name, atrb_se = excluded.atrb_se,
             sgg_cd = excluded.sgg_cd, geom = excluded.geom, updated_at = now()""",
        (BESSEL_TM_CENTRAL,),
    )
    conn.execute("update zone_boundaries set area_m2 = ST_Area(geom::geography) where area_m2 is null or updated_at > now() - interval '1 hour'")
    return len(shapes)


def attach_boundaries(conn) -> dict:
    """정보몽땅 사업장 점 → 경계. 1) 결정고시 코드 2) 점을 품는 가장 작은 정비 계열 구역(30만㎡ 이하)."""
    by_code = conn.execute(
        """update redevelopment_zones z set geom = b.geom, area_m2 = coalesce(z.area_m2, b.area),
             attrs = z.attrs || jsonb_build_object('geo', 'boundary', 'boundary', b.names)
           from (select wtnnc_sn, ST_Multi(ST_Union(geom)) as geom, sum(area_m2) as area, jsonb_agg(distinct name) as names
                 from zone_boundaries where wtnnc_sn is not null group by wtnnc_sn) b
           where z.source_key like 'seoul:%%' and z.attrs->>'map_code' = b.wtnnc_sn
             and (z.attrs->>'geo' is distinct from 'boundary' or not ST_Equals(z.geom, b.geom))"""
    ).rowcount
    by_point = conn.execute(
        """update redevelopment_zones z set geom = b.geom, area_m2 = coalesce(z.area_m2, b.area_m2),
             attrs = z.attrs || jsonb_build_object('geo', 'boundary', 'boundary', jsonb_build_array(b.name))
           from (select distinct on (z2.id) z2.id, b.geom, b.area_m2, b.name
                 from redevelopment_zones z2 join zone_boundaries b on ST_Contains(b.geom, z2.geom) and b.area_m2 <= 300000
                 where z2.source_key like 'seoul:%%' and GeometryType(z2.geom) = 'POINT'
                 order by z2.id, b.area_m2) b
           where z.id = b.id"""
    ).rowcount
    return {"by_code": by_code, "by_point": by_point}


def collect_seoul_boundaries(conn, max_age_days: int = 25) -> dict:
    fresh = conn.execute(
        "select max(updated_at) > now() - make_interval(days => %s) as ok from zone_boundaries", (max_age_days,)
    ).fetchone()["ok"]
    stats: dict = {}
    if not fresh:
        shapes = read_shapes(download_zip())
        stats["shapes"] = save_boundaries(conn, shapes)
    stats.update(attach_boundaries(conn))
    conn.commit()
    return stats
