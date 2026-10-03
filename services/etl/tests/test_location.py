import json
import math

from myrealty_etl.analytics import location as loc
from myrealty_etl.collectors import pois, projects


def test_classify_store():
    assert pois.classify_store("음식", "비알코올", "카페") == ("cafe", "카페")
    assert pois.classify_store("음식", "한식", "백반/한정식") == ("food", "한식")
    assert pois.classify_store("교육", "기타 교육", "입시·교과학원") == ("academy", "입시·교과학원")
    assert pois.classify_store("소매", "종합 소매", "편의점") == ("convenience", "편의점")
    assert pois.classify_store("소매", "종합 소매", "대형마트") == ("mart", "대형마트")
    assert pois.classify_store("수리·개인", "세탁", "세탁소") is None
    assert pois.classify_hospital("종합병원") == ("hospital", "종합병원")
    assert pois.classify_hospital("치과의원") == ("clinic", "치과의원")


def test_parse_semas_hira():
    rows = pois.parse_semas({"header": {"resultCode": "00"}, "body": {"totalCount": 2, "items": [
        {"bizesId": "1", "bizesNm": "스타벅스", "brchNm": "잠실점", "indsLclsNm": "음식", "indsMclsNm": "비알코올", "indsSclsNm": "카페", "lon": "127.1", "lat": "37.5"},
        {"bizesId": "2", "bizesNm": "세탁", "indsLclsNm": "수리·개인", "indsMclsNm": "세탁", "indsSclsNm": "세탁소", "lon": "127.1", "lat": "37.5"},
    ]}})
    assert len(rows) == 1 and rows[0]["name"] == "스타벅스 잠실점" and rows[0]["category"] == "cafe"
    h = pois.parse_hira({"response": {"body": {"items": {"item": {"ykiho": "x", "yadmNm": "서울아산병원", "clCdNm": "상급종합", "XPos": "127.108", "YPos": "37.526"}}}}})
    assert h[0]["category"] == "hospital" and h[0]["subcategory"] == "상급종합"


def test_parse_csv(fixture_text):
    wgs, tm = pois.parse_csv(fixture_text("subway.csv"), "subway", "subway")
    assert len(wgs) == 2 and wgs[0]["name"] == "잠실" and wgs[0]["subcategory"] == "2호선" and wgs[0]["source_id"] == "0216"
    wgs2, tm2 = pois.parse_csv(fixture_text("mart_tm.csv"), "mart", "mart")
    assert not wgs2 and tm2[0]["x"] == 209600.12


def test_linear_and_stage():
    assert loc.linear(200, 300, 1500) == 100 and loc.linear(1500, 300, 1500) == 0 and loc.linear(900, 300, 1500) == 50
    assert projects.stage_order("관리처분인가", projects.ZONE_STAGES) == 6
    assert projects.stage_order("개통 예정", projects.INFRA_STATUS) == 5


def test_score_point_missing_categories():
    pts = [{"category": "subway", "subcategory": "2호선", "name": "잠실", "area_m2": None, "d": 250.0},
           {"category": "cafe", "subcategory": "카페", "name": "c", "area_m2": None, "d": 100.0}]
    total, s = loc.score_point(pts, {"subway", "cafe"})
    # 버스정류장 자료가 없으면 버스 구성요소를 빼고 나머지 비중으로: 역 거리 100×0.55 + 1개 노선 45×0.15 → /0.7
    assert s["transit"]["score"] == 88.2
    assert s["transit"]["details"][1]["n_lines"] == 1
    assert s["school"]["status"] == "미수집"
    assert s["jobs"]["status"] == "미수집"  # 좌표를 안 주면 직주근접은 계산하지 않는다
    assert total is not None and 0 <= total <= 100


def test_compute_locations_db(conn, fixture_text, tmp_path):
    uid = conn.execute("insert into users (email) values ('l@example.com') returning id").fetchone()["id"]
    conn.execute(
        """insert into watch_items (user_id, property_type, label, geom) values
           (%s, 'apt', '집', ST_SetSRID(ST_MakePoint(127.0930, 37.5120), 4326))""", (uid,))
    conn.commit()
    p = tmp_path / "subway.csv"
    p.write_text(fixture_text("subway.csv"), encoding="cp949")
    assert pois.import_csv(conn, str(p), "subway")["wgs84"] == 2
    m = tmp_path / "mart.csv"
    m.write_text(fixture_text("mart_tm.csv"), encoding="utf-8")
    assert pois.import_csv(conn, str(m), "mart")["tm"] == 1
    lat = conn.execute("select ST_Y(geom) as y from pois where category = 'mart'").fetchone()["y"]
    assert 37.4 < lat < 37.6  # TM(5174) → WGS84 변환 확인
    projects.upsert_infra(conn, {"name": "테스트역", "kind": "station", "status": "개통예정", "expected_open": "2030-01-01"},
                          {"type": "Point", "coordinates": [127.095, 37.513]}, "t1")
    projects.upsert_zone(conn, {"name": "테스트 재건축", "kind": "재건축", "stage": "조합설립"},
                         {"type": "Point", "coordinates": [127.094, 37.511]}, "z1")
    conn.commit()
    stats = loc.compute_locations(conn)
    assert stats["items"] == 1
    row = conn.execute("select total, scores, development from location_scores").fetchone()
    assert row["scores"]["transit"]["details"][0]["name"] == "잠실새내"
    assert row["development"]["zones_count"] == 1 and row["development"]["nearest_planned_station"]["name"] == "테스트역"


def test_park_score_uses_edge_distance_size_and_area():
    # 큰 공원(30ha) 경계가 바로 옆(d=0), 반경 1km 안에 25ha 가 겹침 → 공원 100
    big = [{"category": "park", "subcategory": None, "name": "호수공원", "area_m2": 300_000.0, "area_1km": 250_000.0, "d": 0.0}]
    _, s = loc.score_point(big, {"park"})
    assert s["park"]["score"] > 98
    assert s["park"]["details"][0]["area_m2"] == 300_000
    # 어린이공원(3천㎡)만 100m → 거리는 만점이지만 규모 60% · 면적 3%
    small = [{"category": "park", "subcategory": None, "name": "어린이공원", "area_m2": 3_000.0, "area_1km": 3_000.0, "d": 100.0}]
    _, s2 = loc.score_point(small, {"park"})
    assert 40 < s2["park"]["score"] < 45
    # 둘 다 있으면 조금 멀어도 큰 공원을 가장 좋은 공원으로 본다
    both = small + [{**big[0], "d": 400.0}]
    _, s3 = loc.score_point(both, {"park"})
    assert s3["park"]["details"][0]["name"] == "호수공원"


def test_osm_outline_way_and_relation():
    from myrealty_etl.collectors import osm

    way = {"type": "way", "id": 1, "tags": {"leisure": "park", "name": "A공원"},
           "geometry": [{"lat": 37.0, "lon": 127.0}, {"lat": 37.0, "lon": 127.01}, {"lat": 37.01, "lon": 127.01}, {"lat": 37.0, "lon": 127.0}]}
    rel = {"type": "relation", "id": 2, "tags": {"leisure": "park", "name": "B공원"},
           "members": [{"type": "way", "role": "outer", "geometry": [{"lat": 37.0, "lon": 127.0}, {"lat": 37.0, "lon": 127.02}]},
                       {"type": "way", "role": "outer", "geometry": [{"lat": 37.0, "lon": 127.02}, {"lat": 37.02, "lon": 127.0}, {"lat": 37.0, "lon": 127.0}]}]}
    rows = osm.parse({"elements": [way, rel]})
    assert [r["name"] for r in rows] == ["A공원", "B공원"]
    assert len(rows[0]["lines"]) == 1 and len(rows[1]["lines"]) == 2
    assert all(r["category"] == "park" and r["lng"] and r["lat"] for r in rows)


def test_saturate_and_decay():
    assert loc.saturate(0, 10) == 0
    assert 63 < loc.saturate(10, 10) < 64 and 86 < loc.saturate(20, 10) < 87
    assert loc.decay_weight(100, 500) == 1 and loc.decay_weight(375, 500) == 0.5 and loc.decay_weight(600, 500) == 0


def _pts(cat, n, d, sub=None, prefix="p"):
    return [{"category": cat, "subcategory": sub, "name": f"{prefix}{cat}{i}", "area_m2": None, "d": float(d)} for i in range(n)]


def test_counts_no_longer_saturate_in_dense_areas():
    """예전 산식(개수/포화, 100 상한)은 도시에서 거의 다 만점이었다 — 보통 수준과 밀집 상권을 구별해야 한다."""
    avail = {"academy", "food", "cafe"}
    typical = _pts("academy", 150, 400) + _pts("food", 180, 200)
    dense = _pts("academy", 600, 400) + _pts("food", 500, 200)
    sparse = _pts("academy", 20, 400) + _pts("food", 25, 200)
    s = {k: loc.score_point(v, avail)[1] for k, v in (("t", typical), ("d", dense), ("s", sparse))}
    for cat in ("academy", "food"):
        assert s["s"][cat]["score"] < 35 < s["t"][cat]["score"] < 95 < s["d"][cat]["score"]


def test_count_distance_weight_and_dedupe():
    near = _pts("convenience", 6, 100)
    far = _pts("convenience", 6, 450, prefix="f")
    _, a = loc.score_point(near, {"convenience"})
    _, b = loc.score_point(far, {"convenience"})
    da, db = a["shopping"]["details"][-1], b["shopping"]["details"][-1]
    assert da["count"] == db["count"] == 6 and da["eff"] == 6 and db["eff"] < 2
    # 같은 이름·같은 거리대(원천만 다른 중복)는 한 번만
    dup = near + [{**p, "subcategory": "편의점"} for p in near]
    _, c = loc.score_point(dup, {"convenience"})
    assert c["shopping"]["details"][-1]["count"] == 6


def test_supermarket_is_not_a_big_store():
    sm = [{"category": "mart", "subcategory": "슈퍼마켓", "name": "동네슈퍼", "area_m2": None, "d": 100.0}]
    _, s = loc.score_point(sm, {"mart"})
    big, cnt = s["shopping"]["details"][0], s["shopping"]["details"][1]
    assert big["name"] is None and big["score"] == 0 and cnt["count"] == 1
    dept = [{"category": "mart", "subcategory": "백화점", "name": "백화점", "area_m2": None, "d": 400.0}]
    _, s2 = loc.score_point(dept, {"mart"})
    assert s2["shopping"]["details"][0]["score"] == 100


def test_station_lines_and_transfer():
    csv = [{"category": "subway", "subcategory": "2호선", "name": "잠실역", "source": "csv:subway", "source_id": "1", "area_m2": None, "d": 300.0},
           {"category": "subway", "subcategory": "8호선", "name": "잠실", "source": "csv:subway", "source_id": "2", "area_m2": None, "d": 320.0},
           {"category": "subway", "subcategory": "2호선", "name": "잠실새내", "source": "csv:subway", "source_id": "3", "area_m2": None, "d": 200.0}]
    _, s = loc.score_point(csv, {"subway"})
    lines = s["transit"]["details"][1]
    assert lines["name"] == "잠실" and lines["n_lines"] == 2 and lines["lines"] == ["2호선", "8호선"] and lines["score"] == 80
    # 노선 정보가 없는 OSM: 같은 이름의 역 노드가 여러 개면 환승역으로 추정
    osm = [{"category": "subway", "subcategory": "subway", "name": "왕십리", "source": "osm", "source_id": f"node/{i}", "area_m2": None, "d": 500.0}
           for i in range(3)]
    _, s2 = loc.score_point(osm, {"subway"})
    assert s2["transit"]["details"][1]["n_lines"] == 3 and s2["transit"]["details"][1]["guess"] is True
    # 걸어갈 수 없는(1.2km 밖) 역은 노선 점수 0
    _, s3 = loc.score_point([{**osm[0], "d": 1500.0}], {"subway"})
    assert s3["transit"]["details"][1]["score"] == 0


def test_job_access_orders_locations():
    gongdeok = loc.job_access(126.9515, 37.5443)[0]   # 여의도·광화문 사이
    jamsil = loc.job_access(127.1001, 37.5133)[0]
    suji = loc.job_access(127.0980, 37.3220)[0]
    yangpyeong = loc.job_access(127.4875, 37.4917)[0]
    assert gongdeok > jamsil > suji > yangpyeong
    assert gongdeok > 85 and yangpyeong < 15
    total, s = loc.score_point([], set(), 127.1001, 37.5133)
    assert s["jobs"]["details"][0]["name"] == "강남(GBD)" and s["jobs"]["score"] == round(jamsil, 1)
    assert total is None  # 시설 자료가 없으면 직주근접만으로 총점을 내지 않는다


def _calib_rows(n=80, seed=1):
    import random

    rnd = random.Random(seed)
    rows = []
    for i in range(n):
        sc = {k: {"score": rnd.uniform(20, 100)} for k in loc.SPECS}
        by = rnd.randint(1985, 2022)
        # 가격은 교통 점수(점당 +0.8%)와 연식으로만 정해진다 + 잡음
        lp = 7.0 + 0.008 * sc["transit"]["score"] - 0.01 * (2026 - by) + rnd.gauss(0, 0.03) + (0.5 if i % 2 else 0)
        total = sum(sc[k]["score"] * w for k, (_, w, _) in loc.SPECS.items())
        rows.append({"sgg_cd": "11710" if i % 2 else "41465", "ppm2": math.exp(lp), "build_year": by, "total": total, "scores": sc})
    return rows


def test_calibration_fit_recovers_the_price_driver():
    from myrealty_etl.analytics import location_calibration as lc

    r = lc.fit(_calib_rows())
    assert r and r["n"] == 80 and r["sggs"] == 2
    assert r["r2_categories"] > 0.8 and r["r2_categories"] > r["r2_total"]
    assert 6 < r["effects"]["transit"]["per10_pct"] < 10  # +10점 ≈ +8.3%
    assert max(r["effects"], key=lambda k: r["effects"][k]["weight_fit"]) == "transit"
    # 표본이 적으면 권장 가중치는 현재 가중치 쪽으로 당겨진다
    t = r["effects"]["transit"]
    assert t["weight_now"] < t["weight_suggest"] < t["weight_fit"]
    assert lc.fit(_calib_rows(10)) is None


def test_calibrate_locations_db(conn):
    from myrealty_etl.analytics import location_calibration as lc

    rows = _calib_rows(40)
    for i, r in enumerate(rows):
        cid = conn.execute(
            """insert into complexes (complex_key, property_type, name, name_norm, sgg_cd, build_year)
               values (%s, 'apt', %s, %s, %s, %s) returning id""", (f"k{i}", f"단지{i}", f"단지{i}", r["sgg_cd"], r["build_year"]),
        ).fetchone()["id"]
        conn.execute("insert into location_scores (target_type, target_id, total, scores) values ('complex', %s, %s, %s)",
                     (str(cid), r["total"], json.dumps(r["scores"])))
        for j in range(3):
            conn.execute(
                """insert into transactions (src_hash, property_type, deal_kind, sgg_cd, complex_id, area_m2, deal_date, price)
                   values (%s, 'apt', 'sale', %s, %s, 84, current_date - %s, %s)""",
                (f"t{i}-{j}", r["sgg_cd"], cid, 30 * (j + 1), round(r["ppm2"] * 84)),
            )
    conn.commit()
    out = lc.calibrate_locations(conn)
    assert out["status"] == "ok" and out["complexes_with_price"] == 40
    saved = conn.execute("select n, result from location_calibrations").fetchone()
    assert saved["n"] == 40 and saved["result"]["spread"]["total"]["n"] == 40 and saved["result"]["r2_categories"] > 0.5


def test_avm_location_effect_follows_calibration(conn):
    from myrealty_etl.analytics import avm

    assert avm.loc_price_per_point(conn) == avm.LOC_PER_POINT_DEFAULT
    conn.execute("""insert into location_calibrations (n, result) values (50, '{"status": "ok", "total_per10_pct": 4.0}')""")
    assert abs(avm.loc_price_per_point(conn) - math.log(1.04) / 10) < 1e-9
    conn.execute("""insert into location_calibrations (n, result) values (50, '{"status": "ok", "total_per10_pct": 30.0}')""")
    assert avm.loc_price_per_point(conn) == avm.LOC_PER_POINT_MAX


def test_dense_categories_only_counted_within_dense_radius():
    """POI_SQL 은 밀집 시설을 DENSE_R 안에서만 읽는다 — 그 시설을 거리(near)·면적으로 쓰거나 더 넓게 세면 점수가 틀어진다."""
    for _key, (_label, _w, comps) in loc.SPECS.items():
        for kind, cats, _subs, prm, _share in comps:
            dense = set(cats) & set(loc.DENSE)
            if not dense:
                continue
            assert kind == "count" and prm["r"] <= loc.DENSE_R, (kind, cats, prm)
            assert set(cats) <= set(loc.DENSE)


def test_dedupe_is_order_independent():
    a = {"name": "정류장", "d": 120.0}
    b = {"name": "정류장", "d": 130.0}
    assert loc.dedupe([a, b]) == loc.dedupe([b, a]) == [a]


def _complex(conn, name, lng, lat):
    return conn.execute(
        """insert into complexes (complex_key, name, name_norm, property_type, sgg_cd, geom)
           values (%s, %s, %s, 'apt', '11710', ST_SetSRID(ST_MakePoint(%s, %s), 4326)) returning id""",
        (f"t|{name}", name, name, lng, lat)).fetchone()["id"]


def test_compute_locations_scores_complexes_in_collected_cells(conn):
    inside = _complex(conn, "격자 안", 127.0855, 37.5105)
    outside = _complex(conn, "격자 밖", 127.2055, 37.6105)
    pois.upsert_pois(conn, [{"source": "t", "source_id": "s1", "category": "subway", "subcategory": "2호선", "name": "잠실새내",
                             "lng": 127.0860, "lat": 37.5110, "area_m2": None, "attrs": {}}])
    conn.execute("insert into poi_cells (cx, cy, sources) values (%s, %s, '{osm}')", (int(127.0855 // 0.01), int(37.5105 // 0.01)))
    # 시설이 갖춰지지 않은 곳의 예전 점수는 지워지고, 간이 점수는 남는다
    conn.execute("insert into location_scores (target_type, target_id, total, scores, basis) values ('complex', %s, 90, '{}', 'full')", (str(outside),))
    conn.commit()
    stats = loc.compute_locations(conn)
    assert stats["complexes"] == 1
    rows = {r["target_id"]: r for r in conn.execute("select target_id, basis, total from location_scores where target_type = 'complex'")}
    assert set(rows) == {str(inside)} and rows[str(inside)]["basis"] == "full"
    # 다시 돌려도 신선한 점수는 건너뛴다
    assert loc.compute_locations(conn)["complexes"] == 0
    conn.execute("insert into location_scores (target_type, target_id, total, scores, basis) values ('complex', %s, 40, '{}', 'quick')", (str(outside),))
    conn.commit()
    loc.compute_locations(conn)
    assert conn.execute("select basis from location_scores where target_id = %s", (str(outside),)).fetchone()["basis"] == "quick"


def test_collect_cells_marks_complete_cells(conn, monkeypatch):
    from myrealty_etl.collectors import osm
    from myrealty_etl.jobs import pois_job

    _complex(conn, "A", 127.0855, 37.5105)
    _complex(conn, "B", 127.0858, 37.5101)  # 같은 칸
    _complex(conn, "C", 127.1055, 37.5105)
    conn.commit()
    calls = []
    import dataclasses

    monkeypatch.setattr(pois_job, "settings", dataclasses.replace(pois_job.settings, data_go_kr_key=None))
    monkeypatch.setattr(osm, "fetch", lambda lng, lat, r, small=None: calls.append((round(lng, 3), round(lat, 3), r, small)) or [])
    stats = pois_job.collect_cells(conn, max_cells=1)
    assert (stats["cells"], stats["pending"]) == (1, 1)
    # 단지가 많은 칸부터, 칸 중심에서 OSM 2.5km(밀집 1.8km)
    assert calls == [(127.085, 37.515, 2500, 1800)]
    assert conn.execute("select count(*) n from poi_cells").fetchone()["n"] == 1
    assert pois_job.collect_cells(conn)["cells"] == 1
    assert pois_job.collect_cells(conn)["cells"] == 0  # 30일 안에는 다시 받지 않는다
