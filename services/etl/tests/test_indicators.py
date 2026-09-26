from datetime import date

from myrealty_etl.analytics import indicators as ind
from myrealty_etl.demo import seed_demo


def test_monthly_payment():
    # 3억, 연 4%, 30년 원리금균등 ≈ 143.2만원
    assert round(ind.monthly_payment(30000, 4.0), 1) == 143.2
    assert ind.monthly_payment(12000, 0) == 12000 / 360


def test_zscore_and_band():
    z = ind.zscore_series([1.0] * 11 + [1.0, 3.0], min_n=12)
    assert z[10] is None and z[11] == 0.0 and z[12] > 2
    assert ind.temp_band(10) == "냉각" and ind.temp_band(65) == "강세" and ind.temp_band(100) == "과열"


def test_compute_region_on_demo(conn):
    today = date(2026, 9, 26)
    seed_demo(conn, "t@example.com", today=today, years=6)
    res = ind.compute_region(conn, "11710", today)
    assert res["months"] > 60
    temp = conn.execute(
        "select value from series_values where code = 'ind.temp.11710' order by period desc limit 1"
    ).fetchone()["value"]
    assert 0 <= temp <= 100
    idx = [r["value"] for r in conn.execute("select value from series_values where code = 'idx.11710' order by period")]
    assert abs(idx[0] - 100) < 1e-6 and len(idx) > 50
    # 합성 시장은 2021 고점 → 2022~23 하락: 지수에 반영되어야 함
    peak = conn.execute("select value from series_values where code = 'idx.11710' and period = '2022-01-01'").fetchone()["value"]
    trough = conn.execute("select value from series_values where code = 'idx.11710' and period = '2023-06-01'").fetchone()["value"]
    assert trough < peak
    jr = conn.execute("select value from series_values where code = 'jr.11710' order by period desc limit 1").fetchone()["value"]
    assert 0.4 < jr < 0.7
