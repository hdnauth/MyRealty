from myrealty_etl.jobs.cleanup_job import cleanup_auth


def test_cleanup_keeps_recent_and_live(conn):
    uid = conn.execute("insert into users (email) values ('a@example.com') returning id").fetchone()["id"]
    conn.execute(
        """insert into otp_codes (email, code_hash, expires_at, ip, created_at) values
           ('a@example.com', 'x', now() - interval '40 days', '1.1.1.1', now() - interval '40 days'),
           ('a@example.com', 'y', now() + interval '5 minutes', '1.1.1.1', now())"""
    )
    conn.execute(
        """insert into sessions (user_id, expires_at, revoked_at) values
           (%(u)s, now() - interval '40 days', null),
           (%(u)s, now() + interval '30 days', now() - interval '31 days'),
           (%(u)s, now() + interval '30 days', null),
           (%(u)s, now() - interval '3 days', null)""",
        {"u": uid},
    )
    conn.execute(
        """insert into ai_feedback (surface, excerpt, reason, status, resolved_at) values
           ('chat', 'a', 'wrong', 'resolved', now() - interval '400 days'),
           ('chat', 'b', 'wrong', 'resolved', now() - interval '10 days'),
           ('chat', 'c', 'wrong', 'open', null)"""
    )
    conn.commit()
    assert cleanup_auth(conn) == {"otp_codes": 1, "sessions": 2, "ai_feedback": 1, "guests": 0}
    assert conn.execute("select count(*) as n from otp_codes").fetchone()["n"] == 1
    assert conn.execute("select count(*) as n from sessions").fetchone()["n"] == 2


def test_cleanup_removes_unreachable_guests(conn):
    old = "now() - interval '10 days'"
    gone, live, fresh = (
        conn.execute(f"insert into users (email, created_at) values (null, {old}) returning id").fetchone()["id"],
        conn.execute(f"insert into users (email, created_at) values (null, {old}) returning id").fetchone()["id"],
        conn.execute("insert into users (email) values (null) returning id").fetchone()["id"],
    )
    member = conn.execute(f"insert into users (email, created_at) values ('m@example.com', {old}) returning id").fetchone()["id"]
    conn.execute(
        """insert into sessions (user_id, expires_at, revoked_at) values
           (%(gone)s, now() - interval '1 day', null),
           (%(live)s, now() + interval '80 days', null)""",
        {"gone": gone, "live": live},
    )
    conn.commit()
    assert cleanup_auth(conn)["guests"] == 1
    left = {r["id"] for r in conn.execute("select id from users").fetchall()}
    assert left == {live, fresh, member}
