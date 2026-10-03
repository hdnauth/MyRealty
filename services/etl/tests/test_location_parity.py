"""입지 점수 Python ↔ 웹(TypeScript) 일치 확인용 입력·기대값 묶음.

웹은 지도에서 점수를 즉석으로 계산한다(apps/web/src/lib/location-score.ts). 두 구현이 같은 결과를 내는지
같은 묶음(apps/web/src/lib/__tests__/fixtures/location-parity.json)으로 양쪽 테스트가 확인한다.

공식·가중치를 바꿨으면: UPDATE_LOCATION_PARITY=1 uv run pytest tests/test_location_parity.py → 웹 쪽도 맞춘다.
"""

import json
import math
import os
import random
from pathlib import Path

from myrealty_etl.analytics import location as loc

FIXTURE = Path(__file__).resolve().parents[3] / "apps/web/src/lib/__tests__/fixtures/location-parity.json"

# (카테고리, 하위분류 후보, 최대 거리, 개수)
KINDS = [
    ("subway", ["2호선", "9호선", None, "신분당선"], 2500, 4),
    ("bus", [None], 900, 10),
    ("school", ["초등학교", "중학교", "고등학교"], 2000, 6),
    ("mart", ["대형마트", "백화점", "슈퍼마켓", "supermarket", "편의점"], 3500, 6),
    ("convenience", [None], 900, 6),
    ("park", [None], 2500, 4),
    ("academy", ["입시", "예체능"], 1000, 12),
    ("hospital", ["종합병원", "상급종합", "병원"], 6000, 3),
    ("clinic", ["내과", "치과", "한의원", "요양병원"], 1000, 8),
    ("food", ["한식"], 600, 10),
    ("cafe", [None], 600, 6),
]
POINTS = [(127.0930, 37.5120), (126.9246, 37.5300), (129.0592, 35.1600), (127.2590, 36.5040), (126.65, 37.40), (128.0, 36.0)]


def build_cases() -> list[dict]:
    rnd = random.Random(20261003)
    cases = []
    for i, (lng, lat) in enumerate(POINTS):
        pois = []
        for cat, subs, far, n in KINDS:
            for j in range(rnd.randint(0, n)):
                d = round(rnd.uniform(0, far), 1)
                sub = rnd.choice(subs)
                p = {"source": rnd.choice(["semas", "osm", "csv:x"]), "source_id": f"{'node' if rnd.random() < 0.5 else 'way'}/{i}{j}{cat}",
                     "category": cat, "subcategory": sub, "name": f"{cat}{rnd.randint(0, 4)}", "area_m2": None, "line": None,
                     "d": d, "area_1km": None}
                if cat == "park":
                    p["area_m2"] = rnd.choice([None, 3000.0, 25000.0, 120000.0])
                    p["area_1km"] = p["area_m2"] and round(p["area_m2"] * rnd.uniform(0.2, 1.0), 1)
                if cat == "subway" and rnd.random() < 0.4:
                    p["line"] = rnd.choice(["2호선", "2호선;8호선", "수인분당선"])
                pois.append(p)
        # 같은 시설이 원천만 달라 겹친 경우(중복 제거)
        if pois:
            dup = dict(pois[0], source="osm", source_id="node/dup", d=pois[0]["d"] + 10)
            pois.append(dup)
        avail = sorted({p["category"] for p in pois} - ({"bus"} if i == 4 else set()))
        with_xy = i != 5
        cases.append({"lng": lng if with_xy else None, "lat": lat if with_xy else None, "available": avail, "pois": pois})
    # 시설이 하나도 없는 곳(직주근접만 → 총점 없음)
    cases.append({"lng": 127.0, "lat": 37.5, "available": [], "pois": []})
    return cases


def compute(case: dict) -> dict:
    total, scores = loc.score_point(case["pois"], set(case["available"]), case["lng"], case["lat"])
    return {"total": total, "scores": scores}


def test_parity_fixture_is_current():
    cases = build_cases()
    data = {"cases": [{**c, "expected": compute(c)} for c in cases]}
    if os.environ.get("UPDATE_LOCATION_PARITY"):
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    saved = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert len(saved["cases"]) == len(data["cases"])
    for got, want in zip(data["cases"], saved["cases"], strict=True):
        assert got["pois"] == want["pois"]
        assert _close(got["expected"], want["expected"]), "입지 공식이 바뀌었다 — UPDATE_LOCATION_PARITY=1 로 다시 만들고 웹도 맞출 것"


def _close(a, b) -> bool:
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_close(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, float) or isinstance(b, float):
        return a is not None and b is not None and math.isclose(a, b, abs_tol=1e-9)
    return a == b
