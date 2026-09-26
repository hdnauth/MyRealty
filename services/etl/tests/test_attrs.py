import json

from myrealty_etl.collectors import building, vworld
from myrealty_etl.jobs.attrs_job import parse_dong_ho


def test_building_parse(fixture_text):
    titles = [building.parse_title(i) for i in building._items(json.loads(fixture_text("building_title.json")))]
    recap_items = building._items(json.loads(fixture_text("building_recap.json")))
    assert len(titles) == 2 and titles[0]["approved_at"] == "2008-09-30" and titles[0]["parking"] == 150
    assert len(recap_items) == 1  # 단일 item 도 리스트로
    s = building.summarize({"titles": titles, "recap": building.parse_recap(recap_items[0])})
    assert s == {"households": 5678, "build_year": 2008, "vl_rat": 274.8, "bc_rat": 13.9}


def test_building_empty():
    assert building._items({"response": {"body": {"items": ""}}}) == []


def test_vworld_land_characteristics(fixture_text):
    data = json.loads(fixture_text("vworld_landchar.json"))
    ch = vworld.parse_land_characteristics(vworld._fields(data, "landCharacteristicss"))
    assert ch["year"] == 2025 and ch["official_price"] == 41200 and ch["jimok"] == "임야"
    assert ch["land_use_zone"] == ["계획관리지역"] and ch["road_side"] == "맹지"


def test_prices_and_dong_ho():
    rows = [{"stdrYear": "2024", "pblntfPc": "1,500,000,000"}, {"stdrYear": "2025", "pblntfPc": "1,650,000,000"}]
    assert [p["price"] for p in vworld.parse_prices(rows, "pblntfPc")] == [1500000000, 1650000000]
    assert parse_dong_ho("101동 1502호") == ("101", "1502")
    assert parse_dong_ho(None) == (None, None)
