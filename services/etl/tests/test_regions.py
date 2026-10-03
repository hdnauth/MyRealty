from dataclasses import replace

from myrealty_etl import config
from myrealty_etl.transforms import regions

SQUARE = {"type": "MultiPolygon", "coordinates": [[[[126.60, 37.63], [126.61, 37.63], [126.61, 37.64], [126.60, 37.64], [126.60, 37.63]]]]}


def _ri(code, full):
    return {"properties": {"li_cd": code, "full_nm": full, "li_kor_nm": full.split()[-1]}, "geometry": SQUARE}


def test_pick_feature_matches_sgg_and_full_name():
    feats = [
        _ri("4148025625", "경기도 파주시 법원읍 대능리"),
        _ri("4157034021", "경기도 김포시 대곶면 대능리"),
    ]
    assert regions.pick_feature(feats, "41570", "대곶면 대능리")[0] == "4157034021"
    # 같은 시군구라도 읍면이 다르면 고르지 않는다
    assert regions.pick_feature(feats, "41570", "통진읍 대능리") is None
    # 읍면동 경계는 8자리 emd_cd → 뒤에 00
    emd = [{"properties": {"emd_cd": "41465104", "full_nm": "경기도 용인시 수지구 고기동"}, "geometry": SQUARE}]
    assert regions.pick_feature(emd, "41465", "고기동")[0] == "4146510400"


def test_fill_regions_links_land_trades(conn, monkeypatch):
    monkeypatch.setattr(regions, "settings", replace(config.settings, vworld_key="test"))
    calls = []

    def fake(layer, attr_filter, conn=None):
        calls.append((layer, attr_filter))
        if attr_filter == "li_kor_nm:=:대능리":
            return [_ri("4157034021", "경기도 김포시 대곶면 대능리")]
        if attr_filter == "emd_cd:=:41570104":
            return [{"properties": {"emd_cd": "41570104", "full_nm": "경기도 김포시 장기동"}, "geometry": SQUARE}]
        return []

    monkeypatch.setattr(regions, "_features", fake)
    conn.execute("insert into regions (lawd_cd, emd, level) values ('4157010400', '장기동', 3)")
    for i, umd in enumerate(["대곶면 대능리", "대곶면 대능리", "없는리"]):
        conn.execute(
            """insert into transactions (src_hash, property_type, deal_kind, sgg_cd, umd_nm, deal_date, price)
               values (%s, 'land', 'sale', '41570', %s, current_date, 1000)""",
            (f"h{i}", umd),
        )
    conn.commit()

    stats = regions.fill_regions(conn)
    assert stats == {"centers": 1, "named": 1, "missed": 1}
    r = conn.execute("select emd, center is not null as c, geom is not null as g from regions where lawd_cd = '4157034021'").fetchone()
    assert r == {"emd": "대곶면 대능리", "c": True, "g": True}
    assert conn.execute("select center is not null as c from regions where lawd_cd = '4157010400'").fetchone()["c"]
    assert conn.execute("select count(*) as n from transactions where lawd_cd = '4157034021'").fetchone()["n"] == 2

    # 실패는 기억해 두고 다시 묻지 않는다
    calls.clear()
    regions.fill_regions(conn)
    assert calls == []
