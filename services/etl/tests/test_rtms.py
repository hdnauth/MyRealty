from datetime import date

import pytest

from myrealty_etl.collectors import rtms

APT_SALE = next(s for s in rtms.SERVICES if s.property_type == "apt" and s.kind == "sale")
APT_RENT = next(s for s in rtms.SERVICES if s.property_type == "apt" and s.kind == "rent")
LAND = next(s for s in rtms.SERVICES if s.property_type == "land")


def _rows(text, svc, sgg):
    items, total = rtms.parse_xml(text)
    return rtms.dedupe_hashes([r for r in (rtms.normalize(i, svc, sgg) for i in items) if r]), total


def test_parse_apt_trade(fixture_text):
    rows, total = _rows(fixture_text("rtms_apt_trade.xml"), APT_SALE, "11710")
    assert total == 4 and len(rows) == 4
    r = rows[0]
    assert r["price"] == 275000 and r["area_m2"] == 84.8 and r["floor"] == 15
    assert r["deal_date"] == date(2026, 8, 12) and r["lawd_cd"] == "1171010100"
    assert r["apt_seq"] == "11710-6183" and r["is_direct"] is False
    canceled = rows[1]
    assert canceled["is_canceled"] and canceled["canceled_at"] == date(2026, 8, 20) and canceled["is_direct"]
    # 완전히 같은 두 거래는 서로 다른 해시를 가져야 한다
    assert rows[2]["src_hash"] != rows[3]["src_hash"]


def test_hash_ignores_cancel_flag(fixture_text):
    rows, _ = _rows(fixture_text("rtms_apt_trade.xml"), APT_SALE, "11710")
    r = dict(rows[1])
    r["is_canceled"], r["canceled_at"] = False, None
    assert rtms.source_hash(r) == rtms.source_hash(rows[1])


def test_parse_apt_rent(fixture_text):
    rows, _ = _rows(fixture_text("rtms_apt_rent.xml"), APT_RENT, "11710")
    assert rows[0]["deal_kind"] == "jeonse" and rows[0]["price"] == 120000 and rows[0]["renewal_used"] is True
    assert rows[1]["deal_kind"] == "wolse" and rows[1]["monthly_rent"] == 150
    assert rows[0]["lawd_cd"] is None  # 전월세 응답에는 umdCd 가 없을 수 있음


def test_parse_land(fixture_text):
    rows, _ = _rows(fixture_text("rtms_land.xml"), LAND, "41830")
    r = rows[0]
    assert r["jimok"] == "임야" and r["area_m2"] == 1523 and r["price"] == 12500 and r["jibun"] == "산1**"


def test_error_response(fixture_text):
    with pytest.raises(rtms.RtmsError, match="30"):
        rtms.parse_xml(fixture_text("rtms_error.xml"))


def test_upsert_and_complex_matching(conn, fixture_text):
    from myrealty_etl.jobs.rtms_job import upsert_regions
    from myrealty_etl.transforms.complexes import ComplexMatcher

    sale, _ = _rows(fixture_text("rtms_apt_trade.xml"), APT_SALE, "11710")
    rent, _ = _rows(fixture_text("rtms_apt_rent.xml"), APT_RENT, "11710")
    upsert_regions(conn, sale)
    m = ComplexMatcher(conn)
    m.assign(sale)
    m.assign(rent)
    # 전월세(aptSeq 없음, 이름 공백 차이)도 매매와 같은 단지로 매칭
    assert rent[0]["complex_id"] == sale[0]["complex_id"] == rent[1]["complex_id"]
    assert sale[2]["complex_id"] != sale[0]["complex_id"]
    s1 = rtms.upsert(conn, sale + rent)
    assert s1 == {"inserted": 6, "updated": 0}
    # 재수집: 변경 없으면 0건, 해제 반영되면 update
    sale[0]["is_canceled"], sale[0]["canceled_at"] = True, date(2026, 9, 1)
    s2 = rtms.upsert(conn, sale)
    assert s2 == {"inserted": 0, "updated": 1}
    n = conn.execute("select count(*) as n from complexes").fetchone()["n"]
    assert n == 2
