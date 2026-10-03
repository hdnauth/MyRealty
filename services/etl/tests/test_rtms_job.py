from datetime import date

from myrealty_etl.collectors import rtms
from myrealty_etl.jobs import rtms_job
from myrealty_etl.transforms.complexes import link_watch_items


def test_month_list():
    assert rtms_job.month_list(date(2026, 1, 15), 3) == ["202601", "202512", "202511"]


def test_collect_month_and_link(conn, fixture_text, monkeypatch):
    sale_items, _ = rtms.parse_xml(fixture_text("rtms_apt_trade.xml"))

    def fake_fetch(svc, sgg, ym, conn=None):
        if svc.property_type == "apt" and svc.kind == "sale":
            return rtms.dedupe_hashes([rtms.normalize(i, svc, sgg) for i in sale_items])
        return []

    monkeypatch.setattr(rtms, "fetch", fake_fetch)
    stats = rtms_job.collect_month(conn, "11710", "202608")
    assert stats["inserted"] == 4
    # 법정동 등록 확인
    assert conn.execute("select emd from regions where lawd_cd = '1171010100'").fetchone()["emd"] == "잠실동"

    uid = conn.execute("insert into users (email) values ('t@example.com') returning id").fetchone()["id"]
    conn.execute(
        """insert into watch_items (user_id, property_type, label, sgg_cd, lawd_cd, pnu)
           values (%s, 'apt', '테스트', '11710', '1171010100', '1171010100100190000')""",
        (uid,),
    )
    res = link_watch_items(conn)
    assert res["linked"] == 1
    name = conn.execute(
        "select c.name from watch_items w join complexes c on c.id = w.complex_id where w.label = '테스트'"
    ).fetchone()["name"]
    assert name == "잠실엘스"


def _backfill_targets(conn, monkeypatch):
    from dataclasses import replace

    from myrealty_etl import config

    monkeypatch.setattr(config, "settings", replace(config.settings, data_go_kr_key="test"))
    conn.execute("insert into collect_targets (sgg_cd, name, backfill_months, created_at) values "
                 "('11710', '송파구', 36, now() - interval '1 day'), ('11680', '강남구', 36, now())")
    conn.commit()
    calls = []
    monkeypatch.setattr(rtms_job, "collect_month", lambda c, sgg, ym: calls.append((sgg, ym)) or {})
    return calls


def test_backfill_round_robin(conn, monkeypatch):
    calls = _backfill_targets(conn, monkeypatch)
    res = rtms_job.backfill(conn, max_months_per_run=2, today=date(2026, 10, 3))
    # 최근 3개월(8~10월)은 rtms 가 맡으므로 7월부터, 지역을 번갈아
    assert calls == [("11710", "202607"), ("11680", "202607"), ("11710", "202606"), ("11680", "202606")]
    assert res == {"months": 4, "quota_stop": False, "time_stop": False}
    rows = conn.execute("select sgg_cd, backfilled_to from collect_targets order by sgg_cd").fetchall()
    assert [(r["sgg_cd"], r["backfilled_to"]) for r in rows] == [("11680", date(2026, 6, 1)), ("11710", date(2026, 6, 1))]


def test_backfill_stops_at_deadline(conn, monkeypatch):
    import time

    calls = _backfill_targets(conn, monkeypatch)
    res = rtms_job.backfill(conn, today=date(2026, 10, 3), deadline=time.monotonic() - 1)
    assert calls == []
    assert res["time_stop"] is True and res["months"] == 0
