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


def test_legacy_pnu_for_reorganized_region():
    from myrealty_etl.codes import legacy_pnu

    # 전남광주통합특별시 광양시(12190) → 옛 전라남도 광양시(46230), 읍면동 이하 그대로
    assert legacy_pnu("1219031026201640013", "전남광주통합특별시", "광양시") == "4623031026201640013"
    assert legacy_pnu("1215013300118840000", "전남광주통합특별시", "순천시") == "4615013300118840000"
    assert legacy_pnu("4111710300113530000", "경기도", "수원시 영통구") is None
    assert legacy_pnu(None, "전남광주통합특별시", "광양시") is None
