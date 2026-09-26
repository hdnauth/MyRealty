from datetime import date

from myrealty_etl.collectors import applyhome
from myrealty_etl.jobs import events_job

ROW = {
    "HOUSE_MANAGE_NO": "2026000123", "PBLANC_NO": "2026000123", "HOUSE_NM": "잠실 르엘", "HOUSE_SECD_NM": "APT",
    "HSSPLY_ADRES": "서울특별시 송파구 잠실동 27번지 일대", "TOT_SUPLY_HSHLDCO": 1865, "RCRIT_PBLANC_DE": "2026-09-01",
    "RCEPT_BGNDE": "2026-09-10", "RCEPT_ENDDE": "2026-09-12", "MVN_PREARNGE_YM": "202912", "SUBSCRPT_AREA_CODE_NM": "서울",
    "PBLANC_URL": "https://www.applyhome.co.kr/x",
}


def test_parse_applyhome():
    evs = applyhome.parse(ROW)
    assert [e["kind"] for e in evs] == ["subscription", "move_in"]
    assert evs[0]["starts_on"] == date(2026, 9, 10) and evs[0]["ends_on"] == date(2026, 9, 12)
    assert evs[1]["starts_on"] == date(2029, 12, 1)


def test_annual_and_upsert(conn):
    n = events_job.annual_events(conn, date(2026, 9, 26))
    assert n == 10
    assert events_job.annual_events(conn, date(2026, 9, 26)) == 10  # 멱등
    assert conn.execute("select count(*) as n from events").fetchone()["n"] == 10
    events_job.upsert_event(conn, applyhome.parse(ROW)[0], (127.09, 37.51))
    conn.commit()
    row = conn.execute("select ST_X(geom) as x from events where kind = 'subscription'").fetchone()
    assert abs(row["x"] - 127.09) < 1e-9
