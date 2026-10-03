from dataclasses import replace

from myrealty_etl import config
from myrealty_etl.collectors import landuse_zones as lz
from myrealty_etl.collectors import zone_common

# 격자(0.004°) 하나: x 127.028~127.032, y 37.284~37.288
X0, Y0 = 127.028, 37.284
SQ = 0.0002  # 필지 한 변(약 20m)


def _parcel(pnu, x, y, codes, names, hits=None, mnnm="0001", slno="0000"):
    ring = [[x, y], [x + SQ, y], [x + SQ, y + SQ], [x, y + SQ], [x, y]]
    return {"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": [[ring]]},
            "properties": {"pnu": pnu, "mnnm": mnnm, "slno": slno, "regstr_se_code": "1",
                           "prpos_area_dstrc_code_list": ",".join(codes), "prpos_area_dstrc_nm_list": ",".join(names),
                           "cnflc_at_nm_list": ",".join(hits or ["포함"] * len(codes))}}


CAND = (["UQA122", "UDT999"], ["제2종일반주거지역", "정비구역기타(정비사업 후보지 행위제한지역)"])
ZONE = (["UDT100", "UQA122"], ["정비구역", "제2종일반주거지역"])


def _features():
    feats = []
    # 후보지: 3×4 필지(1m 틈 — 이어 붙어야 한다), 가장 작은 pnu 가 499-10
    for i in range(3):
        for j in range(4):
            n = i * 4 + j
            feats.append(_parcel(f"41115140001{499 + n:04d}{10 if n == 0 else 0:04d}", 127.0293 + i * (SQ + 0.00001), 37.2853 + j * (SQ + 0.00001),
                                 *CAND, mnnm=f"{499 + n:04d}", slno="0010" if n == 0 else "0000"))
    # 정비구역: 3×3 필지
    for i in range(3):
        for j in range(3):
            feats.append(_parcel(f"411151400010{100 + i * 3 + j:03d}0000", 127.0305 + i * SQ, 37.2862 + j * SQ, *ZONE))
    # 정비와 무관한 필지
    feats.append(_parcel("4111514000109990000", 127.0315, 37.2875, ["UQA122"], ["제2종일반주거지역"]))
    return feats


def test_classify_reads_codes_by_position_and_names_by_text():
    # 이름 안의 쉼표 때문에 이름 목록이 코드보다 길다
    p = {"prpos_area_dstrc_code_list": "UQQ600,UDT999,UDT100,UDK300",
         "prpos_area_dstrc_nm_list": "토지거래계약에관한허가구역(대상자: 외국인 등, 아파트),정비구역기타(정비사업 후보지 행위제한지역),정비구역,소규모",
         "cnflc_at_nm_list": "포함,포함,접함,저촉"}
    assert lz.classify(p) == {"candidate": "정비구역기타(정비사업 후보지 행위제한지역)", "small": "소규모주택정비사업의 사업시행구역"}
    # 정비구역기타라도 후보지·행위제한이 아니면 뺀다
    assert lz.classify({"prpos_area_dstrc_code_list": "UDT999", "prpos_area_dstrc_nm_list": "정비구역기타(기타)", "cnflc_at_nm_list": "포함"}) == {}
    assert lz.jibun_of({"mnnm": "0499", "slno": "0010", "regstr_se_code": "1"}) == "499-10"
    assert lz.jibun_of({"mnnm": "0012", "slno": "0000", "regstr_se_code": "2"}) == "산 12"
    assert zone_common.stage_order("정비사업 후보지(행위제한)") == 1
    assert zone_common.stage_order("행위제한(구역 지정 전)") == 1


def test_save_tile_queues_neighbor_when_zone_reaches_edge(conn):
    edge = _parcel("4111514000100010000", X0 + 0.004 - SQ, 37.2855, *ZONE)
    res = lz.save_tile(conn, round(X0 / lz.TILE), round(Y0 / lz.TILE), [edge])
    assert res["parcels"] == 1
    assert res["edges"] == {(round(X0 / lz.TILE) + 1, round(Y0 / lz.TILE))}


def test_boundaries_candidates_and_release(conn, monkeypatch):
    monkeypatch.setattr(lz, "settings", replace(config.settings, vworld_key="test"))
    conn.execute("insert into collect_targets (sgg_cd, name) values ('41115', '경기도 수원시 팔달구')")
    conn.execute("""insert into complexes (complex_key, property_type, name, name_norm, sgg_cd, geom)
                    values ('k1', 'rowhouse', '빌라', '빌라', '41115', ST_SetSRID(ST_MakePoint(127.0301, 37.2851), 4326))""")
    conn.execute("""insert into regions (lawd_cd, sido, sigungu, emd, level)
                    values ('4111514000', '경기도', '수원시 팔달구', '우만동', 3)""")
    # 경기 출처의 점 구역(지번 지오코딩) — 정비구역 필지 덩어리 안
    conn.execute("""insert into redevelopment_zones (source_key, name, kind, stage, stage_order, sgg_cd, geom, attrs)
                    values ('gyeonggi:A', '팔달1구역', '재건축', '관리처분인가', 6, '41115',
                            ST_SetSRID(ST_MakePoint(127.0308, 37.2865), 4326), '{"geo": "address", "sido": "경기도"}')""")
    conn.commit()
    feats = _features()
    served = {"feats": feats}

    def fake_fetch(x0, y0, x1, y1, depth=0):
        return [f for f in served["feats"] if x0 <= f["geometry"]["coordinates"][0][0][0][0] < x1
                and y0 <= f["geometry"]["coordinates"][0][0][0][1] < y1]

    monkeypatch.setattr(lz, "fetch_box", fake_fetch)
    s = lz.collect_landuse_zones(conn)
    assert s["tiles"] >= 1 and s["parcels"] == 21
    assert s["attached"] == 1 and s["candidates_new"] == 1

    z = conn.execute("""select GeometryType(geom) as t, attrs->>'geo' as geo, attrs->'landuse'->>'code' as code
                        from redevelopment_zones where source_key = 'gyeonggi:A'""").fetchone()
    assert (z["t"], z["geo"], z["code"]) == ("MULTIPOLYGON", "landuse", "zone")
    c = conn.execute("""select name, kind, stage, stage_order, GeometryType(geom) as t, sgg_cd, (attrs->>'candidate')::boolean as cand,
                          (attrs->'landuse'->>'parcels')::int as parcels
                        from redevelopment_zones where source_key like 'landuse:%'""").fetchone()
    assert c["name"] == "우만동 499-10 일대" and c["kind"] == "재개발"
    assert (c["stage"], c["stage_order"], c["t"], c["sgg_cd"], c["cand"]) == ("정비사업 후보지(행위제한)", 1, "MULTIPOLYGON", "41115", True)
    assert c["parcels"] == 12  # 1m 틈은 이어 붙인다

    # 다시 돌려도 같은 후보지를 새로 만들지 않는다
    s = lz.collect_landuse_zones(conn)
    assert s["candidates_new"] == 0 and conn.execute("select count(*) as n from redevelopment_zones where source_key like 'landuse:%'").fetchone()["n"] == 1

    # 뉴스에 구역 이름과 대표 지번이 함께 나오면 그 이름을 붙인다
    conn.execute("""insert into articles (url, title, description, published_at)
                    values ('u1', '수원 우만(가)구역 정비구역 지정 공람', '팔달구 우만동 499-10 일원 4164가구', now())""")
    conn.commit()
    import myrealty_etl.transforms.geocode as gc
    monkeypatch.setattr(gc, "geocode", lambda conn, q, **k: (127.0294, 37.2854))
    assert lz.name_from_news(conn) == 1
    assert conn.execute("select name from redevelopment_zones where source_key like 'landuse:%'").fetchone()["name"] == "우만가구역"

    # 격자를 다시 받았는데 후보지 지정이 빠졌다 → 해제(단계 이력 남김)
    conn.execute("update poi_fetches set fetched_at = now() - interval '46 days' where key like 'luz:%'")
    conn.execute("update redevelopment_zones set updated_at = now() - interval '47 days'")
    conn.commit()
    served["feats"] = [f for f in feats if "UDT999" not in f["properties"]["prpos_area_dstrc_code_list"]]
    s = lz.collect_landuse_zones(conn)
    assert s["candidates_released"] == 1
    r = conn.execute("select stage, stage_order from redevelopment_zones where source_key like 'landuse:%'").fetchone()
    assert (r["stage"], r["stage_order"]) == ("해제", 9)
    assert conn.execute("select count(*) as n from zone_stage_history").fetchone()["n"] == 1


def test_candidate_hidden_when_source_zone_overlaps(conn, monkeypatch):
    monkeypatch.setattr(lz, "settings", replace(config.settings, vworld_key="test"))
    conn.execute("insert into collect_targets (sgg_cd, name) values ('41115', '경기도 수원시 팔달구')")
    conn.execute("""insert into regions (lawd_cd, sido, sigungu, emd, level) values ('4111514000', '경기도', '수원시 팔달구', '우만동', 3)""")
    conn.execute("""insert into complexes (complex_key, property_type, name, name_norm, sgg_cd, geom)
                    values ('k1', 'rowhouse', '빌라', '빌라', '41115', ST_SetSRID(ST_MakePoint(127.0301, 37.2851), 4326))""")
    conn.commit()
    monkeypatch.setattr(lz, "fetch_box", lambda *a, **k: [f for f in _features() if "UDT999" in f["properties"]["prpos_area_dstrc_code_list"]])
    lz.collect_landuse_zones(conn)
    # 시·도 시스템에 같은 곳(정비구역지정 전 단계)이 올라왔다 → 그 구역이 경계를 받고, 후보지는 숨긴다
    conn.execute("""insert into redevelopment_zones (source_key, name, kind, stage, stage_order, sgg_cd, geom, attrs)
                    values ('gyeonggi:B', '우만가구역', '재개발', '정비구역지정 전', 1, '41115',
                            ST_SetSRID(ST_MakePoint(127.0294, 37.2854), 4326), '{"geo": "address"}')""")
    conn.commit()
    s = lz.collect_landuse_zones(conn)
    assert s["attached"] == 1 and s["candidates_merged"] == 1
    rows = {r["source_key"].split(":")[0]: r for r in conn.execute(
        "select source_key, stage_order, GeometryType(geom) as t, attrs->'landuse'->>'code' as code from redevelopment_zones")}
    assert rows["gyeonggi"]["t"] == "MULTIPOLYGON" and rows["gyeonggi"]["code"] == "candidate"
    assert rows["landuse"]["stage_order"] == 9
    # 합친 것은 단계 변화 알림 대상이 아니다
    assert conn.execute("select count(*) as n from zone_stage_history").fetchone()["n"] == 0


def test_in_region_requires_matching_sigungu():
    assert zone_common.in_region("경기도 안양시 만안구 안양동 1", "경기도", "안양만안구")
    assert not zone_common.in_region("경기도 수원시 팔달구 우만동 1", "경기도", "안양만안구")
    assert not zone_common.in_region("경기도 수원시 권선구", "경기도", "안산상록구")
    assert zone_common.in_region("경기도 의정부시 가능동", "경기도", "의정부시")
    assert zone_common.in_region("경기도 의정부시 가능동", "경기도", None)
    assert not zone_common.in_region("서울특별시 중구", "부산광역시", "중구")
