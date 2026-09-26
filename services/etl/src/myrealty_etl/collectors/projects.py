"""정비사업(재개발·재건축) 구역과 인프라(철도·역·도로) 사업 등록.

공식 API 가 지역마다 다르고 계획 노선은 구조화 데이터가 거의 없어, GeoJSON/CSV 가져오기 + 웹 수동 등록을 지원한다.
GeoJSON Feature properties 예:
  zones: {"name": "잠실우성1·2·3차", "kind": "재건축", "stage": "조합설립", "stage_date": "2023-05-01",
          "households_now": 1842, "households_plan": 2680}
  infra: {"name": "GTX-A 삼성역", "kind": "station", "line_name": "GTX-A", "status": "개통예정", "expected_open": "2028-12-01"}
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path

from ..db import jsonb

ZONE_STAGES = ["기본계획", "정비구역지정", "추진위", "조합설립", "사업시행인가", "관리처분인가", "이주·철거", "착공", "준공"]
INFRA_STATUS = ["계획", "예타", "설계", "착공", "개통예정", "개통"]


def stage_order(stage: str | None, stages: list[str]) -> int | None:
    if not stage:
        return None
    s = stage.replace(" ", "")
    for i, name in enumerate(stages, 1):
        if name.replace("·", "").replace(" ", "") in s.replace("·", "") or s in name:
            return i
    return None


def upsert_zone(conn, props: dict, geom_json: dict | None, source_key: str) -> None:
    conn.execute(
        """insert into redevelopment_zones (source_key, name, kind, stage, stage_order, stage_date, households_now,
             households_plan, area_m2, address, sgg_cd, geom, attrs, updated_at)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
             case when %s::text is null then null else ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) end, %s, now())
           on conflict (source_key) do update set name = excluded.name, kind = excluded.kind, stage = excluded.stage,
             stage_order = excluded.stage_order, stage_date = excluded.stage_date, households_now = excluded.households_now,
             households_plan = excluded.households_plan, geom = coalesce(excluded.geom, redevelopment_zones.geom),
             attrs = excluded.attrs, updated_at = now()""",
        (source_key, props["name"], props.get("kind") or "기타", props.get("stage"),
         stage_order(props.get("stage"), ZONE_STAGES), props.get("stage_date") or None, props.get("households_now"),
         props.get("households_plan"), props.get("area_m2"), props.get("address"), props.get("sgg_cd"),
         json.dumps(geom_json) if geom_json else None, json.dumps(geom_json) if geom_json else None, jsonb(props)),
    )


def upsert_infra(conn, props: dict, geom_json: dict | None, source_key: str) -> None:
    conn.execute(
        """insert into infra_projects (source_key, kind, name, line_name, status, status_order, expected_open, geom, attrs, updated_at)
           values (%s, %s, %s, %s, %s, %s, %s,
             case when %s::text is null then null else ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) end, %s, now())
           on conflict (source_key) do update set kind = excluded.kind, name = excluded.name, line_name = excluded.line_name,
             status = excluded.status, status_order = excluded.status_order, expected_open = excluded.expected_open,
             geom = coalesce(excluded.geom, infra_projects.geom), attrs = excluded.attrs, updated_at = now()""",
        (source_key, props.get("kind") or "station", props["name"], props.get("line_name"), props.get("status") or "계획",
         stage_order(props.get("status"), INFRA_STATUS), props.get("expected_open") or None,
         json.dumps(geom_json) if geom_json else None, json.dumps(geom_json) if geom_json else None, jsonb(props)),
    )


def import_geojson(conn, path: str, kind: str) -> dict:
    """kind: zones | infra"""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    feats = data["features"] if data.get("type") == "FeatureCollection" else [data]
    n = 0
    for i, f in enumerate(feats):
        props = f.get("properties") or {}
        if not props.get("name"):
            continue
        key = props.get("id") or f"{Path(path).stem}:{props['name']}:{i}"
        (upsert_zone if kind == "zones" else upsert_infra)(conn, props, f.get("geometry"), f"file:{key}")
        n += 1
    conn.commit()
    return {"imported": n}


def import_zones_csv(conn, path: str) -> dict:
    """CSV(이름, 유형, 단계, 단계일자, 주소[, 위도, 경도]) → 좌표가 없으면 주소 지오코딩."""
    from ..transforms.geocode import geocode

    text = Path(path).read_bytes().decode("utf-8-sig", errors="replace")
    n = 0
    for i, row in enumerate(csv.DictReader(io.StringIO(text))):
        name = (row.get("이름") or row.get("구역명") or row.get("name") or "").strip()
        if not name:
            continue
        lat, lng = row.get("위도") or row.get("lat"), row.get("경도") or row.get("lng")
        pt = (float(lng), float(lat)) if lat and lng else geocode(conn, row.get("주소") or row.get("address") or "")
        geom = {"type": "Point", "coordinates": list(pt)} if pt else None
        props = {"name": name, "kind": row.get("유형") or row.get("kind"), "stage": row.get("단계") or row.get("stage"),
                 "stage_date": row.get("단계일자") or row.get("stage_date") or None, "address": row.get("주소")}
        upsert_zone(conn, props, geom, f"csv:{Path(path).stem}:{name}:{i}")
        n += 1
    conn.commit()
    return {"imported": n}
