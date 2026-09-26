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
