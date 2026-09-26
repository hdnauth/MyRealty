from datetime import date

import pytest

from myrealty_etl.collectors import macro


def test_parse_ecos():
    data = {"StatisticSearch": {"list_total_count": 2, "row": [
        {"STAT_CODE": "722Y001", "TIME": "202607", "DATA_VALUE": "2.50"},
        {"STAT_CODE": "722Y001", "TIME": "202608", "DATA_VALUE": "2.25"},
    ]}}
    assert macro.parse_ecos(data) == [(date(2026, 7, 1), 2.5), (date(2026, 8, 1), 2.25)]
    assert macro.parse_ecos({"RESULT": {"CODE": "INFO-200", "MESSAGE": "해당하는 데이터가 없습니다."}}) == []
    with pytest.raises(RuntimeError):
        macro.parse_ecos({"RESULT": {"CODE": "ERROR-100", "MESSAGE": "인증키가 유효하지 않습니다."}})


def test_parse_kosis_and_period():
    rows = [{"PRD_DE": "202607", "DT": "1,234", "C1": "11", "C1_NM": "서울특별시"}]
    assert macro.parse_kosis(rows) == [("11", "서울특별시", date(2026, 7, 1), 1234.0)]
    assert macro.period_to_date("2026Q3", "Q") == date(2026, 7, 1)
    with pytest.raises(RuntimeError):
        macro.parse_kosis({"err": "20", "errMsg": "필수요청변수값이 누락되었습니다."})


def test_upsert_series(conn):
    n = macro.upsert_series(conn, "ecos.base_rate", {"name": "기준금리", "unit": "%"}, [(date(2026, 8, 1), 2.25)])
    macro.upsert_series(conn, "ecos.base_rate", {"name": "기준금리", "unit": "%"}, [(date(2026, 8, 1), 2.5)])
    conn.commit()
    assert n == 1
    assert conn.execute("select value from series_values where code = 'ecos.base_rate'").fetchone()["value"] == 2.5
