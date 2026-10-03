"""국토교통부 전국 도시정비사업 통합 데이터(공공데이터포털 15160169, 연 1회) → 정비구역.

시도·시군구·구역명칭·현 사업추진단계·사업유형·사업시행자·공급 예정 세대수(약 1,600곳). 주소·좌표가 없어서
1) 시·도 시스템에서 이미 받은 구역(서울·경기·부산·인천·대전 등)과 이름으로 맞춰 **세대수·시행자만 보태고**,
2) 맞는 곳이 없는 서울 밖 구역은 새로 넣으며 위치를 찾는다(같은 이름 단지 → 브이월드 장소 → 법정동 중심).
파일을 못 받으면(해외 러너 차단 등) 저장소에 함께 둔 사본(data/molit_zones.csv)을 쓴다.
"""

from __future__ import annotations

import csv
import io
import logging
import re
from pathlib import Path

from ..db import jsonb
from .zone_common import dedupe_id, name_key, sgg_key, sido_prefixes, upsert_record
from .zones_regional import download_data_go_kr

log = logging.getLogger(__name__)

DATASET = "15160169"
FALLBACK = Path(__file__).resolve().parent.parent / "data" / "molit_zones.csv"


def parse(text: str) -> list[dict]:
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        r = {(k or "").replace(" ", ""): (v or "").strip() for k, v in row.items()}
        if not r.get("구역명칭"):
            continue
        hh = re.sub(r"[^\d]", "", r.get("공급예정세대수", ""))
        out.append({"sido": r.get("시도", ""), "sgg": r.get("시군구", ""), "name": r["구역명칭"],
                    "stage": r.get("현사업추진단계") or None, "kind": r.get("사업유형") or None,
                    "executor": re.sub(r"^\d+\)", "", r.get("사업시행자", "")) or None,
                    "households": int(hh) if hh and int(hh) > 0 else None})
    return out


def _load() -> tuple[list[dict], str]:
    text = download_data_go_kr(DATASET)
    if text and "구역명칭" in text:
        return parse(text), "data.go.kr"
    return parse(FALLBACK.read_text(encoding="utf-8")), "bundled"


def _match(cands: list[dict], row: dict) -> dict | None:
    """같은 시도 구역 중 이름 키가 같거나(우선) 한쪽이 다른 쪽을 포함하고 시군구가 맞는 것."""
    k = name_key(row["name"])
    if not k:
        return None
    sk = sgg_key(row["sgg"])
    same = [c for c in cands if c["key"] == k]
    near = [c for c in cands if len(k) >= 2 and len(c["key"]) >= 2 and (k in c["key"] or c["key"] in k)]
    for group in (same, near):
        if not group:
            continue
        in_sgg = [c for c in group if sk and c["sgg"] and (sk[-2:] in c["sgg"] or c["sgg"][-2:] in sk)]
        if in_sgg:
            return in_sgg[0]
        if group is same and len(group) == 1:
            return group[0]
    return None


def collect_molit_zones(conn) -> dict:
    rows, origin = _load()
    stats = {"rows": len(rows), "origin": origin, "matched": 0, "new": 0, "changed": 0, "same": 0, "seoul_unmatched": 0}
    seen: dict[str, int] = {}
    existing = conn.execute(
        """select id, name, attrs->>'full_name' as full_name, attrs->>'gu' as gu, attrs->>'sido' as sido, sgg_cd
           from redevelopment_zones where source_key not like 'molit:%%'"""
    ).fetchall()
    # 시도로 후보를 좁힌다: 시군구 코드 앞 두 자리(개편 전·후) 또는 출처가 적은 시도 이름
    by_group: dict[str, list[dict]] = {}
    for z in existing:
        groups = {f"cd:{(z['sgg_cd'] or '')[:2]}", f"nm:{(z['sido'] or '')[:2]}"}
        for name in {z["name"], z["full_name"]} - {None}:
            for g in groups:
                by_group.setdefault(g, []).append({"id": z["id"], "key": name_key(name), "sgg": sgg_key(z["gu"])})
    for row in rows:
        groups = [f"cd:{p}" for p in sido_prefixes(row["sido"])] + [f"nm:{row['sido'][:2]}"]
        picked: set[tuple] = set()
        cands = []
        for g in groups:
            for c in by_group.get(g, []):
                if (c["id"], c["key"]) not in picked:
                    picked.add((c["id"], c["key"]))
                    cands.append(c)
        hit = _match(cands, row)
        molit = {"stage": row["stage"], "kind": row["kind"], "executor": row["executor"], "households": row["households"]}
        if hit:
            conn.execute(
                """update redevelopment_zones set households_plan = coalesce(households_plan, %s),
                     attrs = attrs || jsonb_build_object('molit', %s::jsonb) where id = %s""",
                (row["households"], jsonb(molit), hit["id"]),
            )
            stats["matched"] += 1
            continue
        if row["sido"].startswith("서울"):
            stats["seoul_unmatched"] += 1  # 서울은 정보몽땅이 더 자세하다 — 이름이 달라 못 맞춘 곳은 넣지 않는다
            continue
        rec = {"source": "molit", "source_id": f"{row['sido']}:{row['sgg']}:{row['name']}", "sido": row["sido"],
               "sgg_name": row["sgg"], "name": row["name"], "kind_raw": row["kind"], "stage": row["stage"],
               "households_plan": row["households"], "url": f"https://www.data.go.kr/data/{DATASET}/fileData.do",
               "attrs": {"molit": molit, "executor": row["executor"]}}
        stats[upsert_record(conn, dedupe_id(seen, rec))] += 1
        conn.commit()
    conn.commit()
    return stats
