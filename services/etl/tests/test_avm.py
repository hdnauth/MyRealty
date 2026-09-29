from datetime import date

from myrealty_etl.analytics import avm
from myrealty_etl.analytics.indicators import compute_region
from myrealty_etl.demo import seed_demo


def test_weighted_quantile_and_buckets():
    assert avm.weighted_quantile([1, 2, 3], [1, 1, 1], 0.5) == 2
    assert avm.weighted_quantile([1, 2, 3, 100], [1, 1, 1, 0.0001], 0.5) < 3
    r = avm.bucket_ratios([90, 95, 100, 100, 105, 110, 110, 112], [1, 2, 3, 8, 9, 16, 18, 20])
    assert r["low"] < 1 < r["high"]


def test_valuations_on_demo(conn):
    today = date(2026, 9, 26)
    seed_demo(conn, "v@example.com", today=today, years=6)
    compute_region(conn, "11710", today)
    stats = avm.compute_valuations(conn, today)
    assert stats["valued"] == 3
    rows = {r["method"].split(":")[0]: r for r in conn.execute("select * from valuations")}
    apt = rows["same_complex"]
    assert apt["low"] <= apt["estimate"] <= apt["high"] and apt["confidence"] in ("high", "medium")
    # 합성 데이터의 최근 84㎡ 잠실엘스 가격대(약 18~22억)
    assert 170000 < apt["estimate"] < 240000
    land = rows["land_unit_median"]
    assert land["confidence"] == "low" and land["estimate"] > 0
