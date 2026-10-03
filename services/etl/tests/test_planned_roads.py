from dataclasses import replace

from myrealty_etl import config
from myrealty_etl.collectors import planned_roads as pr
from myrealty_etl.jobs import zones_job

POLY = {"type": "MultiPolygon", "coordinates": [[[[127.0, 37.2], [127.001, 37.2], [127.001, 37.21], [127.0, 37.21], [127.0, 37.2]]]]}


def _road(sn, excut="EMA0002", grade="대로", nm="대로1-1", func="주간선도로"):
    return {"properties": {"present_sn": sn, "excut_se": excut, "exc_nam": "미집행", "grad_se": grade, "dgm_nm": nm, "pmi_nam": func,
                           "ntfc_sn": "41590NTC202312291036", "dgm_lt": "1674", "signgu_se": "41590"}, "geometry": POLY}


def test_names_and_notice_date():
    assert pr.road_name({"dgm_nm": "대로1-1", "pmi_nam": "주간선도로"}) == "대로1-1 · 주간선도로"
    assert pr.road_name({"dgm_nm": "중로3류(폭 12m~15m)/(중로3-5)", "pmi_nam": "국지도로"}) == "중로3류(폭 12m~15m) · 국지도로"
    assert pr.notice_date("41590NTC202312291036") == "2023-12-29"
    assert pr.notice_date(None) is None


def test_collect_saves_refreshes_and_removes(conn, monkeypatch):
    monkeypatch.setattr(pr, "settings", replace(config.settings, vworld_key="test"))
    conn.execute("insert into regions (lawd_cd, emd, level, center) values ('4159010100', '동', 3, ST_SetSRID(ST_MakePoint(127.05, 37.25), 4326))")
    conn.commit()
    batches = [[_road("A"), _road("B", excut="EMA0003", grade="중로", nm="중로2-42", func="집산도로")]]
    monkeypatch.setattr(pr, "fetch_tile", lambda x, y, conn=None: batches[-1])

    s = pr.collect_planned_roads(conn)
    assert (s["fetched"], s["roads"]) == (1, 2)
    rows = {r["source_key"]: r for r in conn.execute("select source_key, kind, name, status, status_order, attrs->>'notice_date' as nd from infra_projects")}
    assert rows["upis-road:A"]["status"] == "미집행" and rows["upis-road:A"]["nd"] == "2023-12-29"
    assert rows["upis-road:B"]["status"] == "부분집행" and rows["upis-road:B"]["status_order"] == 4

    # 60일 안에는 다시 받지 않는다
    assert pr.collect_planned_roads(conn)["fetched"] == 0

    # 다시 받았을 때 빠진 도로(집행 완료)는 지운다
    conn.execute("update poi_fetches set fetched_at = now() - interval '61 days'")
    conn.execute("update infra_projects set updated_at = now() - interval '2 hours'")
    conn.commit()
    batches.append([_road("A")])
    s = pr.collect_planned_roads(conn)
    assert s["removed"] == 1
    assert [r["source_key"] for r in conn.execute("select source_key from infra_projects")] == ["upis-road:A"]


def test_zones_sources_respect_interval(conn, monkeypatch):
    calls = []

    def src(name, changed=0):
        def fn(c):
            calls.append(name)
            return {"new": changed, "changed": 0}
        return fn

    monkeypatch.setattr(zones_job, "STEPS", [("seoul", src("seoul", 1)), ("molit", src("molit")), ("link", src("link")), ("effects", src("effects"))])
    zones_job.collect_zones(conn)
    assert calls == ["seoul", "molit", "link", "effects"]

    # 다음 날: 간격 안이라 출처는 건너뛰고, 바뀐 것이 없으니 분석도 건너뛴다
    calls.clear()
    out = zones_job.collect_zones(conn)
    assert calls == []
    assert "skipped" in out["seoul"] and "skipped" in out["link"]

    # 3일 지나면 서울만 다시(국토부는 30일), 서울에서 바뀐 게 있으면 분석도
    conn.execute("update poi_fetches set fetched_at = now() - interval '4 days' where key = 'zones:seoul'")
    conn.commit()
    calls.clear()
    zones_job.collect_zones(conn)
    assert calls == ["seoul", "link", "effects"]


def test_locate_pending_fills_missing_zone_points(conn, monkeypatch):
    from myrealty_etl.collectors import zone_common

    conn.execute(
        """insert into redevelopment_zones (source_key, name, kind, stage, stage_order, address, attrs)
           values ('gyeonggi:1', '매교구역', '재개발', '조합설립인가', 4, '경기도 수원시 팔달구 교동 1', '{"sido": "경기도"}'),
                  ('busan:2', '없는구역', '재건축', '추진위', 3, null, '{}')"""
    )
    conn.commit()
    monkeypatch.setattr(zone_common, "locate", lambda c, rec: (127.01, 37.27, "address") if rec["address"] else None)
    monkeypatch.setattr(zone_common, "sgg_of_point", lambda lng, lat: "41115")
    assert zone_common.locate_pending(conn, limit=10) == {"pending": 2, "located": 1, "missed": 1}
    r = conn.execute("select sgg_cd, attrs->>'geo' as geo, geom is not null as g from redevelopment_zones where source_key = 'gyeonggi:1'").fetchone()
    assert r == {"sgg_cd": "41115", "geo": "address", "g": True}
    # 못 찾은 곳은 30일 동안 다시 찾지 않는다
    assert zone_common.locate_pending(conn, limit=10)["pending"] == 0
