from datetime import date, datetime, timedelta

from myrealty_etl.alerts import notify, rules


def _setup(conn):
    uid = conn.execute("insert into users (email) values ('a@example.com') returning id").fetchone()["id"]
    cid = conn.execute(
        "insert into complexes (complex_key, property_type, name, name_norm, sgg_cd) values ('k', 'apt', '엘스', '엘스', '11710') returning id"
    ).fetchone()["id"]
    wid = conn.execute(
        """insert into watch_items (user_id, property_type, label, sgg_cd, complex_id, area_m2, lease, loans, geom)
           values (%s, 'apt', '우리집', '11710', %s, 84.8, %s, '[]', ST_SetSRID(ST_MakePoint(127.08, 37.51), 4326)) returning id""",
        (uid, cid, '{"end_date": "%s", "deposit": 100000}' % (date.today() + timedelta(days=20))),
    ).fetchone()["id"]
    old = datetime.now().astimezone() - timedelta(days=10)
    for i, (price, d) in enumerate([(200000, date(2025, 1, 5)), (205000, date(2025, 6, 5)), (210000, date(2026, 1, 5))]):
        conn.execute(
            """insert into transactions (src_hash, property_type, deal_kind, sgg_cd, complex_id, area_m2, deal_date, price, collected_at)
               values (%s, 'apt', 'sale', '11710', %s, 84.8, %s, %s, %s)""",
            (f"old{i}", cid, d, price, old),
        )
    conn.commit()
    return uid, cid, wid


def test_trade_rules_and_idempotency(conn):
    uid, cid, wid = _setup(conn)
    since = datetime.now().astimezone() - timedelta(hours=1)
    conn.execute(
        """insert into transactions (src_hash, property_type, deal_kind, sgg_cd, complex_id, area_m2, deal_date, price, floor)
           values ('new1', 'apt', 'sale', '11710', %s, 84.9, current_date - 10, 225000, 12),
                  ('new2', 'apt', 'jeonse', '11710', %s, 84.8, current_date - 9, 110000, 3)""",
        (cid, cid),
    )
    conn.commit()
    rules.detect_alerts(conn, since)
    kinds = sorted(r["kind"] for r in conn.execute("select kind from notifications"))
    assert kinds == ["lease_expiry", "new_trade", "record_high"]
    hi = conn.execute("select title, priority from notifications where kind = 'record_high'").fetchone()
    assert "22억 5,000만" in hi["title"] and hi["priority"] == 2
    # 다시 실행해도 중복 생성 없음
    rules.detect_alerts(conn, since)
    assert conn.execute("select count(*) as n from notifications").fetchone()["n"] == 3


def test_digest_render():
    subject, text, body = notify.render_digest("a@example.com", [
        {"id": 1, "kind": "record_high", "title": "우리집 신고가 22억", "body": "직전 대비 +7%", "url": "/items/x", "item_label": "우리집"},
        {"id": 2, "kind": "calendar", "title": "공시가격 발표 D-3", "body": None, "url": "/calendar", "item_label": None},
    ])
    assert "2건" in subject and "[신고가]" in text and "<a href=" in body and "공통" in text


def test_fmt():
    assert rules.fmt_manwon(225000) == "22억 5,000만"
    assert rules.fmt_manwon(9500) == "9,500만"
