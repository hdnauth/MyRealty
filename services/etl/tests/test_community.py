from datetime import date, datetime, timedelta

from myrealty_etl import community


def _setup(conn):
    uid = conn.execute("insert into users (email) values ('a@example.com') returning id").fetchone()["id"]
    other = conn.execute("insert into users (email) values ('b@example.com') returning id").fetchone()["id"]
    cid = conn.execute(
        "insert into complexes (complex_key, property_type, name, name_norm, sgg_cd) values ('k', 'apt', '엘스', '엘스', '11710') returning id"
    ).fetchone()["id"]
    conn.execute(
        "insert into watch_items (user_id, property_type, label, sgg_cd, complex_id) values (%s, 'apt', '우리집', '11710', %s)",
        (uid, cid),
    )
    old = datetime.now().astimezone() - timedelta(days=10)
    for i, (price, d) in enumerate([(200000, date(2025, 1, 5)), (205000, date(2025, 6, 5)), (210000, date(2026, 1, 5))]):
        conn.execute(
            """insert into transactions (src_hash, property_type, deal_kind, sgg_cd, complex_id, area_m2, deal_date, price, collected_at)
               values (%s, 'apt', 'sale', '11710', %s, 84.8, %s, %s, %s)""",
            (f"old{i}", cid, d, price, old),
        )
    conn.commit()
    return uid, other, cid


def test_record_high_system_post_is_idempotent(conn):
    _uid, _other, cid = _setup(conn)
    conn.execute(
        """insert into transactions (src_hash, property_type, deal_kind, sgg_cd, complex_id, area_m2, deal_date, price, floor)
           values ('new1', 'apt', 'sale', '11710', %s, 84.9, current_date - 10, 225000, 12),
                  ('new2', 'apt', 'sale', '11710', %s, 84.7, current_date - 10, 221000, 3),
                  ('new3', 'apt', 'sale', '11710', %s, 84.8, current_date - 9, 190000, 5)""",
        (cid, cid, cid),
    )
    conn.execute(
        """insert into events (source_key, kind, title, starts_on, ends_on, sgg_cd, payload)
           values ('ah1', 'subscription', '잠실 르엘', current_date + 3, current_date + 5, '11710', '{"households": 200}')"""
    )
    conn.commit()
    r = community.system_posts(conn)
    # 같은 날 같은 평형 신고가 두 건 → 높은 것 하나만
    assert r == {"record_highs": 1, "subscriptions": 1}
    post = conn.execute("select title, kind, category, complex_id, attachments from community_posts where complex_id is not null").fetchone()
    assert "22억 5,000만" in post["title"] and post["kind"] == "system" and post["category"] == "data"
    assert {a["type"] for a in post["attachments"]} == {"trade", "complex"}
    assert community.system_posts(conn) == {"record_highs": 0, "subscriptions": 0}


def test_hot_alerts_skip_author_and_once_a_day(conn):
    uid, other, cid = _setup(conn)
    # 다른 사용자가 쓴 인기글 → 구독자(uid)에게 알림
    conn.execute(
        """insert into community_posts (user_id, sgg_cd, complex_id, category, title, like_count, comment_count)
           values (%s, '11710', %s, 'question', '주차 어떤가요', 2, 2), (%s, '11710', null, 'info', '내 글', 9, 9)""",
        (other, cid, uid),
    )
    conn.commit()
    assert community.hot_post_alerts(conn) == 1
    n = conn.execute("select user_id, title, url from notifications where kind = 'community_hot'").fetchall()
    assert len(n) == 1 and n[0]["user_id"] == uid and "주차" in n[0]["title"]
    assert community.hot_post_alerts(conn) == 0


def test_cleanup_orphan_images(conn):
    uid, _other, _cid = _setup(conn)
    conn.execute(
        "insert into community_images (user_id, mime, bytes, data, created_at) values (%s, 'image/jpeg', 1, '\\x00', now() - interval '2 days'), (%s, 'image/jpeg', 1, '\\x00', now())",
        (uid, uid),
    )
    conn.commit()
    assert community.cleanup_images(conn) == 1
