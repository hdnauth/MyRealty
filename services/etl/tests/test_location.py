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
    assert s["transit"]["score"] == 70.0  # 역 100×0.7 + 버스 0
    assert s["school"]["status"] == "미수집"
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
    assert s["park"]["score"] == 100.0
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
