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


def test_check_series_reports_each_entry(monkeypatch):
    import dataclasses

    monkeypatch.setattr(macro, "settings", dataclasses.replace(macro.settings, ecos_key="k", kosis_key=None, reb_key=None))

    def fake_ecos(s, start, end, conn=None):
        if s["code"] == "ecos.housing_csi":
            raise RuntimeError("ECOS 오류 INFO-100: 인증키 또는 항목코드 확인")
        return [(date(2026, 7, 1), 1.0), (date(2026, 8, 1), 2.0)]

    monkeypatch.setattr(macro, "fetch_ecos", fake_ecos)
    res = {r["code"]: r for r in macro.check_series(today=date(2026, 9, 1))}
    assert res["ecos.base_rate"]["ok"] is True and res["ecos.base_rate"]["last"] == ["2026-08-01", 2.0]
    assert res["ecos.housing_csi"]["ok"] is False and "INFO-100" in res["ecos.housing_csi"]["note"]
    assert res["kosis.permits"]["ok"] is None and "키 없음" in res["kosis.permits"]["note"]
