from datetime import datetime, timedelta

from myrealty_etl.alerts import rules
from myrealty_etl.collectors import seoul_cleanup, zone_common
from myrealty_etl.transforms import geocode as geocode_mod


def test_parse_list(fixture_text):
    rows = seoul_cleanup.parse_list(fixture_text("seoul_cleanup.html"))
    assert [r["cafe"] for r in rows] == ["gaepo3", "gaepo22", "gaepo6_7"]
    assert rows[0] == {"gu": "강남구", "kind_raw": "재건축", "name": "개포주공3단지아파트 재건축정비사업 조합",
                       "jibun": "개포동 138", "stage": "조합해산", "cafe": "gaepo3", "map_code": "11000AGZ201211160062"}
    assert rows[1]["map_code"] is None


def test_stage_order():
    o = zone_common.stage_order
    assert [o("정비계획 수립"), o("정비구역지정"), o("추진위원회승인"), o("조합설립인가"), o("사업시행인가"),
            o("관리처분인가"), o("철거"), o("철거 및 착공"), o("준공인가")] == [1, 2, 3, 4, 5, 6, 7, 8, 9]
    assert o("조합해산") == o("청산 및 조합해산") == o("이전고시") == 9
    assert o("사업계획승인(리모델링 허가)") == 5
    assert o("") is None and o(None) is None


def test_short_name():
    s = zone_common.short_name
    assert s("개포주공5단지아파트 재건축정비사업 조합") == "개포주공5단지아파트"
    assert s("청화아파트주택재건축정비사업조합설립추진위원회") == "청화아파트"
    assert s("상도15구역 주택정비형 재개발사업") == "상도15구역"
    assert s("마포로1구역 제5지구 도시정비형 재개발사업") == "마포로1구역 제5지구"
    assert s("길동한전우성아파트 소규모주택정비사업조합") == "길동한전우성아파트"
    assert s("(가칭)신길지역주택조합 추진위원회") == "신길지역주택조합"
    assert s("(가칭)화곡1지역주택조합") == "화곡1지역주택조합"
    assert s("노량진2재정비촉진구역 조합") == "노량진2재정비촉진구역"


def test_upsert_history_and_alert(conn, fixture_text, monkeypatch):
    calls = []
    monkeypatch.setattr(geocode_mod, "geocode", lambda c, q, **k: calls.append(q) or (127.07, 37.48))
    rows = seoul_cleanup.parse_list(fixture_text("seoul_cleanup.html"))
    assert [seoul_cleanup.upsert(conn, r) for r in rows] == ["new", "new", "new"]
    assert calls[0] == "서울특별시 강남구 개포동 138"
    z = conn.execute("select * from redevelopment_zones where source_key = 'seoul:gaepo6_7'").fetchone()
    assert (z["name"], z["kind"], z["stage_order"], z["sgg_cd"]) == ("개포주공6,7단지아파트", "재건축", 5, "11680")
    assert z["attrs"]["cafe_url"].endswith("cafeUrl=gaepo6_7")

    # 다시 읽으면 좌표는 다시 찾지 않고, 단계가 바뀐 곳만 이력에 남는다
    calls.clear()
    assert seoul_cleanup.upsert(conn, rows[0]) == "same"
    assert seoul_cleanup.upsert(conn, {**rows[2], "stage": "관리처분인가"}) == "changed"
    assert calls == []
    h = conn.execute("select * from zone_stage_history").fetchall()
    assert [(r["prev_stage"], r["stage"], r["prev_order"], r["stage_order"]) for r in h] == [("사업시행인가", "관리처분인가", 5, 6)]

    # 반경 1km 안 관심 부동산 사용자에게 알림
    user = conn.execute("insert into users (email) values ('a@b.c') returning id").fetchone()["id"]
    conn.execute(
        """insert into watch_items (user_id, label, property_type, sgg_cd, geom)
           values (%s, '우리집', 'apt', '11680', ST_SetSRID(ST_MakePoint(127.075, 37.48), 4326))""",
        (user,),
    )
    assert rules.rule_zone_stages(conn, datetime.now().astimezone() - timedelta(hours=1)) == 1
    assert rules.rule_zone_stages(conn, datetime.now().astimezone() - timedelta(hours=1)) == 0  # 멱등
    n = conn.execute("select * from notifications").fetchone()
    assert n["kind"] == "zone_stage" and n["priority"] == 2 and "사업시행인가 → 관리처분인가" in n["body"]
