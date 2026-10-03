from myrealty_etl.jobs import targets_job as tj


def _setup(conn):
    uid = conn.execute("insert into users (email) values ('a@x.com') returning id").fetchone()["id"]
    conn.execute("insert into collect_targets (sgg_cd, name) values ('41115', '경기도 수원시 팔달구'), ('11680', '서울특별시 강남구')")
    conn.execute("insert into watch_items (user_id, property_type, label, sgg_cd) values (%s, 'apt', '우만 현대', '41115')", (uid,))
    conn.commit()


def test_enables_other_gu_of_same_city(conn):
    _setup(conn)
    # 관리자가 끈 구는 다시 켜지 않는다
    conn.execute("insert into collect_targets (sgg_cd, name, enabled) values ('41111', '경기도 수원시 장안구', false)")
    conn.commit()
    s = tj.expand_city_targets(conn, cap=40)
    assert s["enabled"] == 2
    rows = {r["sgg_cd"]: r for r in conn.execute("select sgg_cd, name, enabled, backfill_months, auto_from from collect_targets")}
    assert rows["41113"]["name"] == "경기도 수원시 권선구" and rows["41113"]["auto_from"] == "41115"
    assert rows["41113"]["backfill_months"] == tj.AUTO_BACKFILL_MONTHS
    assert rows["41117"]["enabled"] and not rows["41111"]["enabled"]
    # 강남구는 관심 부동산이 없고 구가 있는 시도 아니다
    assert tj.expand_city_targets(conn, cap=40)["enabled"] == 0


def test_respects_target_cap(conn):
    _setup(conn)
    s = tj.expand_city_targets(conn, cap=3)
    assert s == {"enabled": 1, "skipped_cap": 2}
