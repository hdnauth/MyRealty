"""추정 시세(AVM) → valuations.

- 단지형(아파트·오피스텔·빌라): 같은 단지·면적 ±3㎡ 최근 24개월 거래를 자체 가격지수로 시점 보정,
  층 보정 후 최근일수록 큰 가중의 가중 중위. 거래가 부족하면 인근 유사 단지(평당가 × 면적, 입지 점수 보정)로 보완.
- 단독·상가 등: 같은 시군구·유형 3년 거래로 로그 ㎡당 가격 헤도닉 회귀(연식·면적·층·시점·동일 읍면동).
- 토지·임야: 같은 읍면동·지목 3년 거래 ㎡당 가격 중위 × 면적(범위는 25~75%), 신뢰도 낮음.

결과는 점추정 + 구간(10~90%) + 근거 comps + 신뢰도(high/medium/low).
"""

from __future__ import annotations

import logging
import math
from datetime import date

import numpy as np
from dateutil.relativedelta import relativedelta

from ..db import jsonb

log = logging.getLogger(__name__)
PY = 3.305785


def weighted_quantile(values: list[float], weights: list[float], q: float) -> float:
    order = np.argsort(values)
    v = np.asarray(values, dtype=float)[order]
    w = np.asarray(weights, dtype=float)[order]
    cw = np.cumsum(w) - 0.5 * w
    cw /= w.sum()
    return float(np.interp(q, cw, v))


def index_map(conn, sgg: str | None) -> dict[date, float]:
    if not sgg:
        return {}
    return {r["period"]: r["value"] for r in conn.execute(
        "select period, value from series_values where code = %s order by period", (f"idx.{sgg}",))}


def time_factor(idx: dict[date, float], deal: date, now: date) -> float:
    """거래 시점 → 현재 시점 가격 보정 배수(지수 없으면 1)."""
    if not idx:
        return 1.0
    months = sorted(idx)

    def at(d: date) -> float | None:
        ks = [m for m in months if m <= d.replace(day=1)]
        return idx[ks[-1]] if ks else None

    a, b = at(deal), at(now) or idx[months[-1]]
    return b / a if a and b else 1.0


def floor_bucket(f: int | None) -> str:
    if f is None:
        return "mid"
    return "low" if f <= 3 else "high" if f >= 15 else "mid"


def value_complex(conn, item: dict, today: date) -> dict | None:
    area = float(item["area_m2"] or 0)
    guessed = not area
    if guessed:
        # 평형을 고르지 않았으면 84㎡ 대신 이 단지에서 가장 많이 거래된 평형(신뢰도는 한 단계 낮춘다)
        row = conn.execute(
            """select round(area_m2) as a from transactions
               where complex_id = %s and deal_kind = 'sale' and not is_canceled and deal_date >= %s
               group by 1 order by count(*) desc limit 1""",
            (item["complex_id"], today - relativedelta(months=24)),
        ).fetchone()
        area = float(row["a"]) if row else 84.0
    idx = index_map(conn, item["sgg_cd"])
    rows = conn.execute(
        """select id, deal_date, price, floor, area_m2 from transactions
           where complex_id = %s and deal_kind = 'sale' and not is_canceled
             and abs(area_m2 - %s) <= 3 and deal_date >= %s and deal_date <= %s order by deal_date""",
        (item["complex_id"], area, today - relativedelta(months=24), today),
    ).fetchall()
    comps, adj, weights = [], [], []
    for r in rows:
        tf = time_factor(idx, r["deal_date"], today)
        months = (today - r["deal_date"]).days / 30.4
        p = r["price"] * tf * (area / float(r["area_m2"]))
        adj.append(p)
        weights.append(math.exp(-months / 9))
        comps.append({"id": r["id"], "date": str(r["deal_date"]), "price": r["price"], "adj": round(p), "floor": r["floor"]})
    # 층 보정: 각 거래를 '평균 층' 가격으로 환산한 뒤 대상 부동산 층 구간 비율을 곱한다
    if len(adj) >= 8 and item.get("floor") is not None:
        ratios = bucket_ratios(adj, [c["floor"] for c in comps])
        mine = ratios.get(floor_bucket(item["floor"]), 1.0)
        adj = [a / ratios.get(floor_bucket(c["floor"]), 1.0) * mine for a, c in zip(adj, comps, strict=True)]
    if len(adj) >= 3:
        est = weighted_quantile(adj, weights, 0.5)
        lo, hi = weighted_quantile(adj, weights, 0.1), weighted_quantile(adj, weights, 0.9)
        lo, hi = min(lo, est * 0.97), max(hi, est * 1.03)
        conf = "high" if len(adj) >= 8 else "medium"
        if guessed:
            conf = "medium" if conf == "high" else "low"
        return {"estimate": est, "low": lo, "high": hi, "method": "same_complex:guessed_area" if guessed else "same_complex",
                "confidence": conf, "comps": comps[-12:]}
    return value_neighbors(conn, item, today, idx, area)


def bucket_ratios(prices: list[float], floors: list[int | None], min_n: int = 3) -> dict[str, float]:
    """층 구간(low/mid/high)별 중위 / 전체 중위. 표본이 적은 구간은 제외(=1로 취급)."""
    allm = float(np.median(prices))
    out: dict[str, float] = {}
    for b in ("low", "mid", "high"):
        grp = [p for p, f in zip(prices, floors, strict=True) if floor_bucket(f) == b]
        if len(grp) >= min_n and allm:
            out[b] = float(np.median(grp)) / allm
    return out


LOC_PER_POINT_DEFAULT = 0.002  # 입지 점수 1점 차이 → 가격 0.2%(검증 결과가 없을 때)
LOC_PER_POINT_MAX = 0.006


def loc_price_per_point(conn) -> float:
    """입지 점수 1점당 가격 효과(로그). 최근 점수 검증(location_calibrations)이 있으면 그 '총점 +10점 효과'를 쓰고
    (0 ~ 0.6%/점으로 제한), 없으면 기본값. 점수 산식이 바뀌어 점수 폭이 달라져도 보정이 과하거나 모자라지 않게."""
    row = conn.execute(
        "select result from location_calibrations where result->>'status' = 'ok' order by computed_at desc, id desc limit 1"
    ).fetchone()
    pct = (row["result"] or {}).get("total_per10_pct") if row else None
    if pct is None:
        return LOC_PER_POINT_DEFAULT
    return min(max(math.log1p(float(pct) / 100) / 10, 0.0), LOC_PER_POINT_MAX)


def value_neighbors(conn, item: dict, today: date, idx: dict, area: float) -> dict | None:
    """인근 유사 단지(1.5km, 면적 ±15%, 연식 ±10년)의 평당가로 추정. 입지 점수 차이를 소폭 반영."""
    if item.get("lng") is None:
        return None
    rows = conn.execute(
        """select t.id, t.deal_date, t.price, t.area_m2, c.id as cid, c.name, c.build_year,
             (select total from location_scores s where s.target_type = 'complex' and s.target_id = c.id::text) as loc
           from transactions t join complexes c on c.id = t.complex_id
           where t.property_type = %(ptype)s and t.deal_kind = 'sale' and not t.is_canceled
             and t.deal_date >= %(since)s and t.deal_date <= %(today)s and t.area_m2 between %(a0)s and %(a1)s
             and c.geom is not null
             and ST_DWithin(c.geom::geography, ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography, 1500)
             and (%(by)s::int is null or c.build_year is null or abs(c.build_year - %(by)s::int) <= 10)
             and c.id is distinct from %(cid)s""",
        {"ptype": item["tx_type"], "since": today - relativedelta(months=18), "today": today, "a0": area * 0.85, "a1": area * 1.15,
         "lng": item["lng"], "lat": item["lat"], "by": item.get("build_year"), "cid": item.get("complex_id")},
    ).fetchall()
    if len(rows) < 5:
        return None
    my_loc = item.get("loc")
    per_point = loc_price_per_point(conn)
    adj, weights, comps = [], [], []
    for r in rows:
        ppy = r["price"] / (float(r["area_m2"]) / PY) * time_factor(idx, r["deal_date"], today)
        loc_adj = math.exp(per_point * (my_loc - r["loc"])) if my_loc is not None and r["loc"] is not None else 1
        adj.append(ppy * loc_adj * area / PY)
        weights.append(math.exp(-((today - r["deal_date"]).days / 30.4) / 9))
        comps.append({"id": r["id"], "date": str(r["deal_date"]), "price": r["price"], "name": r["name"]})
    est = weighted_quantile(adj, weights, 0.5)
    return {"estimate": est, "low": min(weighted_quantile(adj, weights, 0.1), est * 0.92),
            "high": max(weighted_quantile(adj, weights, 0.9), est * 1.08), "method": "neighbor_complexes",
            "confidence": "low" if len(rows) < 15 else "medium", "comps": comps[-12:]}


def value_hedonic(conn, item: dict, today: date) -> dict | None:
    rows = conn.execute(
        """select id, deal_date, price, area_m2, floor, build_year, lawd_cd from transactions
           where sgg_cd = %s and property_type = %s and deal_kind = 'sale' and not is_canceled
             and area_m2 > 0 and deal_date >= %s and deal_date <= %s""",
        (item["sgg_cd"], item["tx_type"], today - relativedelta(years=3), today),
    ).fetchall()
    if len(rows) < 25:
        return None
    y = np.array([math.log(r["price"] / float(r["area_m2"])) for r in rows])

    def feats(age, area, floor, months_ago, same_umd):
        return [1.0, age, math.log(area), floor, months_ago, 1.0 if same_umd else 0.0]

    X = np.array([feats(today.year - (r["build_year"] or today.year - 15), float(r["area_m2"]), r["floor"] or 2,
                        (today - r["deal_date"]).days / 30.4, r["lawd_cd"] == item.get("lawd_cd")) for r in rows])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    sd = float(np.std(resid))
    area = float(item["area_m2"] or np.median([float(r["area_m2"]) for r in rows]))
    x0 = np.array(feats(today.year - (item.get("build_year") or today.year - 15), area, item.get("floor") or 2, 0, True))
    unit = math.exp(float(x0 @ beta))
    est = unit * area
    return {"estimate": est, "low": est * math.exp(-1.2816 * sd), "high": est * math.exp(1.2816 * sd),
            "method": "hedonic", "confidence": "medium" if sd < 0.2 and len(rows) >= 60 else "low",
            "comps": [{"n": len(rows), "resid_sd": round(sd, 3)}]}


def value_land(conn, item: dict, today: date) -> dict | None:
    """토지·임야: 비슷한 크기(1/5~5배)·같은 지목(임야) 거래의 ㎡당 중위 × 내 면적.

    필지가 클수록 ㎡당 가격이 낮아(규모 할인) 크기를 무시하면 큰 임야가 몇 배로 부풀려진다. 같은 리 → 같은 읍면 →
    시군구 순으로 넓혀 3건 이상을 찾고, 끝내 없으면 추정하지 않는다(숫자를 지어내지 않도록).
    """
    area = float(item.get("land_area_m2") or item.get("area_m2") or 0)
    if not area:
        return None
    lawd = item.get("lawd_cd") or ""
    scopes = [("리·동", "lawd_cd = %(lawd)s", lawd), ("읍면동", "substr(lawd_cd, 1, 8) = %(lawd)s", lawd[:8]),
              ("시군구", "sgg_cd = %(lawd)s", item["sgg_cd"])]
    rows: list = []
    basis = ""
    for label, cond, val in scopes:
        if not val:
            continue
        rows = conn.execute(
            f"""select id, deal_date, price, area_m2, jimok from transactions
               where property_type = 'land' and deal_kind = 'sale' and not is_canceled and area_m2 > 0
                 and deal_date >= %(since)s and deal_date <= %(today)s and {cond}
                 and area_m2 between %(a0)s and %(a1)s
                 and (%(forest)s = false or jimok = '임야')""",
            {"since": today - relativedelta(years=3), "today": today, "lawd": val, "a0": area / 5, "a1": area * 5,
             "forest": item["property_type"] == "forest"},
        ).fetchall()
        if len(rows) >= 3:
            basis = label
            break
    if len(rows) < 3:
        return None
    unit = [r["price"] / float(r["area_m2"]) for r in rows]
    est = float(np.median(unit)) * area
    return {"estimate": est, "low": float(np.percentile(unit, 25)) * area, "high": float(np.percentile(unit, 75)) * area,
            "method": f"land_unit_median:{basis}", "confidence": "low",
            "comps": [{"id": r["id"], "date": str(r["deal_date"]), "price": r["price"], "area_m2": float(r["area_m2"])} for r in rows[-10:]]}


TX_TYPE = {"apt": "apt", "officetel": "officetel", "rowhouse": "rowhouse", "house": "house", "commercial": "commercial",
           "land": "land", "forest": "land"}


def value_item(conn, item: dict, today: date | None = None) -> dict | None:
    today = today or date.today()
    item = {**item, "tx_type": TX_TYPE[item["property_type"]]}
    if item["property_type"] in ("land", "forest"):
        return value_land(conn, item, today)
    if item.get("complex_id"):
        return value_complex(conn, item, today)
    if item["property_type"] in ("apt", "officetel", "rowhouse"):
        return value_neighbors(conn, item, today, index_map(conn, item["sgg_cd"]), float(item.get("area_m2") or 84)) \
            or value_hedonic(conn, item, today)
    return value_hedonic(conn, item, today)


def compute_valuations(conn, today: date | None = None, item_id: str | None = None) -> dict:
    today = today or date.today()
    items = conn.execute(
        """select w.id, w.property_type, w.complex_id, w.sgg_cd, w.lawd_cd, w.area_m2, w.land_area_m2, w.floor,
             ST_X(w.geom) as lng, ST_Y(w.geom) as lat, c.build_year,
             (select total from location_scores s where s.target_type = 'item' and s.target_id = w.id::text) as loc
           from watch_items w left join complexes c on c.id = w.complex_id
           where %(id)s::uuid is null or w.id = %(id)s::uuid""",
        {"id": item_id},
    ).fetchall()
    stats = {"valued": 0, "skipped": 0}
    for it in items:
        try:
            v = value_item(conn, dict(it), today)
        except Exception as e:  # 한 부동산 실패가 전체를 막지 않게
            log.warning("AVM 실패 %s: %s", it["id"], e)
            v = None
        if not v:
            stats["skipped"] += 1
            continue
        conn.execute(
            """insert into valuations (watch_item_id, as_of, estimate, low, high, method, confidence, comps)
               values (%s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (watch_item_id, as_of) do update set estimate = excluded.estimate, low = excluded.low,
                 high = excluded.high, method = excluded.method, confidence = excluded.confidence, comps = excluded.comps""",
            (it["id"], today, round(v["estimate"]), round(v["low"]), round(v["high"]), v["method"], v["confidence"],
             jsonb(v["comps"])),
        )
        stats["valued"] += 1
    conn.commit()
    return stats


def backtest(conn, days: int = 365) -> dict:
    """관심 단지의 실제 거래와 직전 추정치 비교 → MAPE."""
    rows = conn.execute(
        """select t.price, v.estimate from watch_items w
           join transactions t on t.complex_id = w.complex_id and t.deal_kind = 'sale' and not t.is_canceled
             and abs(t.area_m2 - w.area_m2) <= 3 and t.deal_date >= current_date - %s
           join lateral (select estimate from valuations v where v.watch_item_id = w.id and v.as_of < t.deal_date
                         order by as_of desc limit 1) v on true""",
        (days,),
    ).fetchall()
    if not rows:
        return {"n": 0}
    errs = [abs(r["estimate"] / r["price"] - 1) for r in rows]
    return {"n": len(errs), "mape": float(np.mean(errs)), "median_ape": float(np.median(errs))}
