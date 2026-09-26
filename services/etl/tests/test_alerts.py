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


def test_blocked_users_excluded(conn, monkeypatch):
    """관리 화면에서 정지된 사용자는 전체 알림·푸시·다이제스트 대상에서 빠진다."""
    from myrealty_etl.analytics import indicators as ind

    active = conn.execute("insert into users (email) values ('ok@example.com') returning id").fetchone()["id"]
    blocked = conn.execute("insert into users (email, status) values ('no@example.com', 'blocked') returning id").fetchone()["id"]
    conn.execute("insert into series (code, name, freq, source) values ('ecos.base_rate', '기준금리', 'M', 'ecos')")
    conn.execute("insert into series_values (code, period, value) values ('ecos.base_rate', '2026-07-01', 2.5), ('ecos.base_rate', '2026-08-01', 2.25)")
    conn.commit()
    ind.detect_rate_change(conn)
    got = {r["user_id"] for r in conn.execute("select user_id from notifications where kind = 'rate'")}
    assert got == {active}

    # 다이제스트 대상 조회에도 정지 사용자 제외
    conn.execute("insert into notifications (user_id, kind, priority, title, dedupe_key) values (%s, 'news', 1, 'x', 'd1')", (blocked,))
    conn.commit()
    sent_to = []
    import dataclasses

    monkeypatch.setattr(notify, "settings", dataclasses.replace(notify.settings, smtp_host="smtp.test"))
    monkeypatch.setattr(notify, "send_mail", lambda to, *a, **k: sent_to.append(to))
    notify.send_digest(conn)
    assert sent_to == ["ok@example.com"]
