from myrealty_etl.analytics import zones as zone_analytics
from myrealty_etl.collectors import molit_zones, zone_common, zones_regional
from myrealty_etl.collectors.zone_common import (
    clean_stage,
    name_key,
    normalize_kind,
    sgg_key,
    stage_date,
    stage_order,
)
from myrealty_etl.transforms import geocode as geocode_mod


def test_stage_rules_across_sources():
    # 경기·부산·인천·대전·국토부 표기
    assert stage_order("추진주체 구성 전") == 1
    assert stage_order("예정구역지정") == 1
    assert stage_order("정비구역지정 전") == 1
    assert stage_order("정비계획 수립 및 정비구역 지정") == 2
    assert stage_order("2)정비구역지정") == 2
    assert stage_order("추진위원회 구성") == stage_order("주민 합의체 구성") == 3
    assert stage_order("조합(시행자)") == stage_order("17)사업시행자지정") == stage_order("조합설림") == 4
    assert stage_order("건축심의 및 통합심의") == 4
    assert stage_order("사업시행계획인가") == 5
    assert stage_order("관리처분계획") == 6
    assert stage_order("7)착공") == 8
    assert stage_order("해제") == stage_order("청산위원회") == 9
    assert clean_stage("6)관리처분인가") == "관리처분인가"
    assert clean_stage("관리처분 (2021-09-09)") == "관리처분"
    assert stage_date("조합설립(21-01-26)") == "2021-01-26" and stage_date("준공(2022-04-28)") == "2022-04-28"
    assert stage_date("착공") is None


def test_kind_and_keys():
    assert normalize_kind("1)재개발(주택정비)") == "재개발"
    assert normalize_kind("2)재개발(도시정비)") == "도시정비형재개발"
    assert normalize_kind("4)재건축(단독주택)") == "재건축"
    assert normalize_kind("5)주거환경개선") == "주거환경개선"
    assert normalize_kind(None, "한독아파트 소규모재건축") == "소규모재건축"
    assert normalize_kind(None, "(가칭)우암1 가로주택정비") == "가로주택"
    assert name_key("북변3구역 재개발") == name_key("북변3") == "북변3"
    assert name_key("장대B구역") == name_key("장대B") == "장대b"
    assert sgg_key("수원시 권선구") == sgg_key("수원권선구") == "수원권선구"


def test_parse_gyeonggi(fixture_text):
    rows = zones_regional.parse_gyeonggi(fixture_text("gyeonggi_list.html"))
    assert len(rows) == 3
    assert rows[0] == {"id": "GHMT_0000000000065", "name": "가능3구역", "addr": "경기도 의정부시 가능동(가능동) 681-2번지 일원",
                       "sgg": "의정부시", "kind": "재개발", "stage": "조합(시행자)"}
    assert zones_regional.clean_address(rows[0]["addr"]) == "경기도 의정부시 가능동 681-2"
    assert zones_regional.clean_address("경기도 성남시 중원구 상대원1동(상대원동) 179번지 일원") == "경기도 성남시 중원구 상대원동 179"
    assert zones_regional.clean_address("대전광역시 동구 신흥동161-33") == "대전광역시 동구 신흥동 161-33"


def test_parse_busan_incheon(fixture_text):
    bs = zones_regional.parse_busan(fixture_text("busan_list.html"))
    assert bs[0] == {"name": "(가칭)우암1 가로주택정비", "sgg": "남구", "addr": "남구 우암동 189-92", "stage": "예정구역지정"}
    assert any(r["stage"] == "해제" for r in bs)
    ic = zones_regional.parse_incheon(fixture_text("incheon_list.html"))
    assert ic[0]["sgg"] == "부평구" and ic[0]["name"] == "현대3단지" and ic[0]["addr"] == "산곡동 370-399"
    assert ic[1]["name"] == "화수아파트일원" and ic[1]["candidate"]


def test_parse_file(fixture_text):
    rows = zones_regional.parse_file(fixture_text("daejeon_redev.csv"), zones_regional.DATA_GO_KR_FILES[0])
    assert rows[0]["name"] == "신흥3" and rows[0]["sgg_name"] == "동구"
    assert rows[0]["address"] == "대전광역시 동구 신흥동 161-33"
    assert rows[0]["households_plan"] == 1588 and rows[0]["stage"] == "준공(2022-04-28)"


def test_parse_molit(fixture_text):
    rows = molit_zones.parse(fixture_text("molit_zones.csv"))
    assert rows[0] == {"sido": "경기도", "sgg": "김포시", "name": "북변3", "stage": "7)착공", "kind": "1)재개발(주택정비)",
                       "executor": "조합", "households": 1200}
    cands = [{"id": 1, "key": name_key("북변3구역"), "sgg": sgg_key("김포시")},
             {"id": 2, "key": name_key("북변3구역"), "sgg": sgg_key("양주시")}]
    assert molit_zones._match(cands, rows[0])["id"] == 1


def test_regional_upsert_and_molit_merge(conn, fixture_text, monkeypatch):
    monkeypatch.setattr(geocode_mod, "geocode", lambda c, q, **k: (126.71, 37.62))
    monkeypatch.setattr(zone_common, "sgg_of_point", lambda lng, lat: "41570")
    monkeypatch.setattr(zone_common, "vworld_search", lambda *a, **k: [])
    monkeypatch.setattr(molit_zones, "download_data_go_kr", lambda pk: fixture_text("molit_zones.csv"))
    rec = {"source": "gyeonggi", "source_id": "G1", "sido": "경기도", "sgg_name": "김포시", "name": "북변3구역",
           "kind_raw": "재개발", "stage": "착공", "address": "경기도 김포시 북변동 1"}
    assert zone_common.upsert_record(conn, rec) == "new"
    conn.commit()
    stats = molit_zones.collect_molit_zones(conn)
    # 북변3 은 경기 자료와 맞춰 세대수만 보태고, 속초는 새로(위치 못 찾음), 서울은 넣지 않는다
    assert (stats["matched"], stats["new"], stats["seoul_unmatched"]) == (1, 1, 1)
    z = conn.execute("select * from redevelopment_zones where source_key = 'gyeonggi:G1'").fetchone()
    assert z["households_plan"] == 1200 and z["sgg_cd"] == "41570" and z["attrs"]["molit"]["executor"] == "조합"
    sokcho = conn.execute("select * from redevelopment_zones where source_key like 'molit:%%'").fetchone()
    assert sokcho["geom"] is None and sokcho["attrs"].get("geo_tried") and sokcho["stage_order"] == 6
    # 못 찾은 곳은 30일 동안 다시 찾지 않는다
    calls = []
    monkeypatch.setattr(zone_common, "locate", lambda c, r: calls.append(r) or None)
    molit_zones.collect_molit_zones(conn)
    assert calls == []


def test_link_complexes_by_name(conn):
    conn.execute(
        """insert into complexes (complex_key, property_type, sgg_cd, name, name_norm, geom)
           values ('k1', 'apt', '11680', '개포주공5단지', '개포주공5단지', ST_SetSRID(ST_MakePoint(127.0703, 37.4893), 4326)),
                  ('k2', 'apt', '11680', '옆단지', '옆단지', ST_SetSRID(ST_MakePoint(127.0710, 37.4893), 4326))"""
    )
    conn.execute(
        """insert into redevelopment_zones (source_key, name, kind, stage, stage_order, geom)
           values ('t:1', '개포주공5단지아파트', '재건축', '관리처분인가', 6, ST_SetSRID(ST_MakePoint(127.0712, 37.4895), 4326)),
                  ('t:2', '경계구역', '재개발', '조합설립인가', 4,
                   ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(127.0710, 37.4893), 4326)::geography, 30)::geometry))"""
    )
    conn.commit()
    stats = zone_analytics.link_zone_complexes(conn)
    assert stats == {"inside": 1, "name": 1, "near": 0}
    rows = conn.execute(
        "select z.name, c.name as cname, how from zone_complexes zc join redevelopment_zones z on z.id = zc.zone_id join complexes c on c.id = zc.complex_id order by how"
    ).fetchall()
    assert [(r["name"], r["cname"], r["how"]) for r in rows] == [("경계구역", "옆단지", "inside"), ("개포주공5단지아파트", "개포주공5단지", "name")]
