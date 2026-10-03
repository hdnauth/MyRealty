"""정비구역 분석: 구역 ↔ 단지 연결, 단계 변화 전후 가격 효과(이벤트 스터디).

연결 규칙
- inside: 경계(폴리곤)가 있는 구역 안의 단지
- name:   경계가 없는 재건축·리모델링 구역 — 600m 안에서 이름이 같은(한쪽이 다른 쪽을 포함) 단지
- near:   그래도 없으면 구역 점에서 120m 안의 가장 가까운 아파트 단지

단계 효과: 사건일(단계 변경 감지일, 또는 출처가 준 단계 날짜) 전 12개월 vs 후 12개월의 연결 단지 전용 평당가 중위 변화를
시군구 자체 가격지수(idx.{시군구}) 변화와 비교해 초과 변화(excess)를 남긴다. 사건 후 3개월이 지나야 계산한다.
"""

from __future__ import annotations

import logging

from ..codes import normalize_name
from ..collectors.zone_common import short_name

log = logging.getLogger(__name__)

REBUILD_KINDS = ("재건축", "소규모재건축", "리모델링")


def link_zone_complexes(conn) -> dict:
    conn.execute("delete from zone_complexes")
    inside = conn.execute(
        """insert into zone_complexes (zone_id, complex_id, how, dist_m)
           select z.id, c.id, 'inside', 0 from redevelopment_zones z
           join complexes c on c.geom is not null and ST_Contains(z.geom, c.geom)
           where GeometryType(z.geom) like '%%POLYGON' and c.property_type in ('apt', 'rowhouse', 'officetel')
           on conflict do nothing"""
    ).rowcount
    zones = conn.execute(
        """select z.id, z.name, z.geom from redevelopment_zones z
           where z.kind = any(%s) and z.geom is not null and GeometryType(z.geom) = 'POINT'
             and not exists (select 1 from zone_complexes zc where zc.zone_id = z.id)""",
        (list(REBUILD_KINDS),),
    ).fetchall()
    by_name = by_near = 0
    for z in zones:
        key = normalize_name(short_name(z["name"]))
        cands = conn.execute(
            """select c.id, c.name_norm, ST_Distance(c.geom::geography, %(g)s::geography)::int as d
               from complexes c where c.geom is not null and c.property_type = 'apt'
                 and ST_DWithin(c.geom::geography, %(g)s::geography, 600)
               order by d""",
            {"g": z["geom"]},
        ).fetchall()
        hit = next((c for c in cands if len(key) >= 2 and c["name_norm"] and (key in c["name_norm"] or c["name_norm"] in key)), None)
        how = "name"
        if not hit:
            hit = next((c for c in cands if c["d"] <= 120), None)
            how = "near"
        if hit:
            conn.execute(
                "insert into zone_complexes (zone_id, complex_id, how, dist_m) values (%s, %s, %s, %s) on conflict do nothing",
                (z["id"], hit["id"], how, hit["d"]),
            )
            by_name += how == "name"
            by_near += how == "near"
    conn.commit()
    return {"inside": inside, "name": by_name, "near": by_near}


EVENTS_SQL = """
select h.id as history_id, h.zone_id, h.stage, h.stage_order, h.changed_at::date as d, z.sgg_cd
from zone_stage_history h join redevelopment_zones z on z.id = h.zone_id
where h.changed_at < now() - interval '90 days'
union all
select null, z.id, z.stage, z.stage_order, z.stage_date, z.sgg_cd from redevelopment_zones z
where (z.attrs->>'stage_dated')::boolean and z.stage_date is not null and z.stage_date < current_date - 90
  and z.stage_date > current_date - interval '8 years'
"""


def stage_effects(conn) -> dict:
    events = conn.execute(EVENTS_SQL).fetchall()
    n = 0
    for e in events:
        c = conn.execute(
            """select
                 percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785))
                   filter (where t.deal_date >= %(d)s::date - 365 and t.deal_date < %(d)s::date)::float8 as before,
                 percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785))
                   filter (where t.deal_date >= %(d)s::date and t.deal_date < %(d)s::date + 365)::float8 as after,
                 count(*) filter (where t.deal_date >= %(d)s::date - 365 and t.deal_date < %(d)s::date)::int as nb,
                 count(*) filter (where t.deal_date >= %(d)s::date and t.deal_date < %(d)s::date + 365)::int as na
               from zone_complexes zc join transactions t on t.complex_id = zc.complex_id
               where zc.zone_id = %(z)s and t.deal_kind = 'sale' and not t.is_canceled and t.area_m2 > 0""",
            {"d": e["d"], "z": e["zone_id"]},
        ).fetchone()
        if not c or c["nb"] < 3 or c["na"] < 3 or not c["before"] or not c["after"]:
            continue
        g = conn.execute(
            """select avg(value) filter (where period >= %(d)s::date - 365 and period < %(d)s::date)::float8 as before,
                      avg(value) filter (where period >= %(d)s::date and period < %(d)s::date + 365)::float8 as after
               from series_values where code = %(code)s""",
            {"d": e["d"], "code": f"idx.{e['sgg_cd']}"},
        ).fetchone() if e["sgg_cd"] else None
        cx = c["after"] / c["before"] - 1
        rg = g["after"] / g["before"] - 1 if g and g["before"] and g["after"] else None
        conn.execute(
            """insert into zone_stage_effects (zone_id, history_id, stage, stage_order, changed_on, complex_change, region_change,
                 excess, n_before, n_after, computed_at)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
               on conflict (zone_id, stage_order, changed_on) do update set complex_change = excluded.complex_change,
                 region_change = excluded.region_change, excess = excluded.excess, n_before = excluded.n_before,
                 n_after = excluded.n_after, computed_at = now()""",
            (e["zone_id"], e["history_id"], e["stage"], e["stage_order"], e["d"], cx, rg, cx - rg if rg is not None else None,
             c["nb"], c["na"]),
        )
        n += 1
    conn.commit()
    return {"events": len(events), "effects": n}
