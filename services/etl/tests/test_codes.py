from myrealty_etl.codes import make_pnu, normalize_name, parse_pnu, to_int


def test_make_pnu():
    assert make_pnu("1171010100", "19") == "1171010100100190000"
    assert make_pnu("1171010100", "산 12-3") == "1171010100200120003"
    assert make_pnu("1171010100", bonbun="0019", bubun="0000") == "1171010100100190000"
    assert make_pnu("1171010100", "1**") is None
    assert make_pnu("11710", "19") is None


def test_parse_pnu_roundtrip():
    p = parse_pnu("1171010100200120003")
    assert p["jibun"] == "산 12-3" and p["sgg_cd"] == "11710" and p["mountain"]


def test_normalize_name():
    assert normalize_name("잠실 엘스") == normalize_name("잠실엘스")
    assert normalize_name("e편한세상(1단지)") == normalize_name("이편한세상 1단지")
    assert normalize_name("래미안아파트") == "래미안"


def test_to_int():
    assert to_int("   275,000") == 275000
    assert to_int("") is None
