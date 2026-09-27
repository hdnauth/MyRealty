"""지역(시군구) 지표 계산 → series(category='region'|'indicator').

외부 지수 없이도 동작하도록 실거래로 자체 가격지수를 만든다(단지 구성 변화 보정).
모든 코드는 `<지표>.<시군구5자리>` 형태, 유형은 아파트 기준.

| 코드              | 의미                                                        |
|-------------------|-------------------------------------------------------------|
| idx.{sgg}         | 자체 가격지수(단지별 평당가 대비 비율의 월 중위, 3M 평활, 시작=100) |
| vol.{sgg}         | 월 매매 건수                                                 |
| med84.{sgg}       | 전용 75~95㎡ 매매가 중위(3개월 이동)                         |
| jr.{sgg}          | 전세가율(전세 평당가 중위 / 매매 평당가 중위, 3개월)         |
| nhr.{sgg}         | 신고가 비율(같은 단지·면적대 직전 최고가 초과 거래 비중, 3M)  |
| dr.{sgg}          | 하락 거래 비율(직전 거래보다 낮은 거래 비중, 3M)               |
| ind.burden.{sgg}  | 월부담지수 = 84㎡ 중위가×LTV 원리금 / 월소득 ×100              |
| ind.pir.{sgg}     | PIR = 84㎡ 중위가 / 연소득                                    |
| ind.real.{sgg}    | 실질가격지수 = idx / (CPI/기준CPI)                          |
| ind.liq.{sgg}     | 유동성 대비 가격 = idx / (M2/기준M2)                        |
| ind.turnover.{sgg}| 거래 회전율 = 월 매매 / 세대수 ×1000                          |
| ind.supply.{sgg}  | 공급압력 = 향후 24개월 입주예정 세대 / 재고 세대 ×100(최신값) |
| ind.temp.{sgg}    | 시장 온도계 0~100, ind.temp_c.<요인>.{sgg} 는 요인별 기여     |
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from datetime import date

import numpy as np
from dateutil.relativedelta import relativedelta

from ..collectors.macro import upsert_series
from ..series_catalog import DEFAULT_ANNUAL_INCOME_MANWON

log = logging.getLogger(__name__)

PY = 3.305785
LTV = 0.5
LOAN_YEARS = 30
MIN_TRADES = 3

TEMP_FACTORS = [
    # (키, 이름, 부호) — 부호 +는 값이 높을수록 온도 상승
    ("momentum", "가격 모멘텀(3개월)", 1),
    ("turnover", "거래량 추세(3M/12M)", 1),
    ("new_high", "신고가 비율", 1),
    ("decline", "하락 거래 비율", -1),
    ("burden", "월부담지수", -1),
]


def month_start(d: date) -> date:
    return d.replace(day=1)


def months_between(a: date, b: date) -> list[date]:
    out, m = [], month_start(a)
    while m <= b:
        out.append(m)
        m += relativedelta(months=1)
    return out


def monthly_payment(principal: float, annual_rate_pct: float, years: int = LOAN_YEARS) -> float:
    """원리금균등 월 상환액."""
    r = annual_rate_pct / 100 / 12
    n = years * 12
    if r <= 0:
        return principal / n
    return principal * r * (1 + r) ** n / ((1 + r) ** n - 1)


def rolling(values: list[float | None], window: int, fn=np.nanmedian) -> list[float | None]:
    arr = np.array([np.nan if v is None else v for v in values], dtype=float)
    out: list[float | None] = []
    for i in range(len(arr)):
        w = arr[max(0, i - window + 1): i + 1]
        out.append(None if np.all(np.isnan(w)) else float(fn(w)))
    return out


def zscore_series(values: list[float | None], min_n: int = 12) -> list[float | None]:
    """확장 창(과거~현재) z-score. 과거 정보만 사용해 미래 참조를 피한다."""
    out: list[float | None] = []
    hist: list[float] = []
    for v in values:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            out.append(None)
            continue
        hist.append(v)
        if len(hist) < min_n:
            out.append(None)
            continue
        mu, sd = float(np.mean(hist)), float(np.std(hist))
        out.append(0.0 if sd < 1e-12 else (v - mu) / sd)
    return out


def norm_cdf(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def series_map(conn, code: str) -> dict[date, float]:
    return {r["period"]: r["value"] for r in conn.execute(
        "select period, value from series_values where code = %s order by period", (code,))}


def asof(m: dict[date, float], d: date) -> float | None:
    """d 이전(포함) 가장 최근 값."""
    ks = [k for k in m if k <= d]
    return m[max(ks)] if ks else None


def compute_region(conn, sgg: str, today: date | None = None, income: float = DEFAULT_ANNUAL_INCOME_MANWON) -> dict:
    today = today or date.today()
    rows = conn.execute(
        """select complex_id, deal_kind, deal_date, price, area_m2 from transactions
           where sgg_cd = %s and property_type = 'apt' and not is_canceled and price > 0 and area_m2 > 0
           order by deal_date, id""",
        (sgg,),
    ).fetchall()
    sales = [r for r in rows if r["deal_kind"] == "sale"]
    if len(sales) < 30:
        return {"sgg": sgg, "skipped": f"매매 {len(sales)}건 — 표본 부족"}
    months = months_between(sales[0]["deal_date"], today)
    mi = {m: i for i, m in enumerate(months)}
    n = len(months)

    # 단지별 평당가 기준값(전 기간 중위)으로 구성 변화 보정
    by_cx: dict = defaultdict(list)
    for r in sales:
        by_cx[r["complex_id"]].append(r["price"] / (float(r["area_m2"]) / PY))
    base = {k: float(np.median(v)) for k, v in by_cx.items() if len(v) >= 3}

    ratio_m: list[list[float]] = [[] for _ in months]
    ppy_m: list[list[float]] = [[] for _ in months]
    j_ppy_m: list[list[float]] = [[] for _ in months]
    p84_m: list[list[float]] = [[] for _ in months]
    vol = [0] * n
    hi_m, dn_m, tot_m = [0] * n, [0] * n, [0] * n
    last_price: dict = {}
    max_price: dict = {}
    for r in rows:
        i = mi.get(month_start(r["deal_date"]))
        if i is None:
            continue
        area = float(r["area_m2"])
        ppy = r["price"] / (area / PY)
        if r["deal_kind"] == "jeonse":
            j_ppy_m[i].append(ppy)
            continue
        if r["deal_kind"] != "sale":
            continue
        vol[i] += 1
        ppy_m[i].append(ppy)
        if 75 <= area <= 95:
            p84_m[i].append(r["price"])
        if r["complex_id"] in base:
            ratio_m[i].append(ppy / base[r["complex_id"]])
        key = (r["complex_id"], round(area / 5))
        if r["complex_id"] is not None:
            if key in last_price:
                tot_m[i] += 1
                if r["price"] > max_price[key]:
                    hi_m[i] += 1
                if r["price"] < last_price[key]:
                    dn_m[i] += 1
            last_price[key] = r["price"]
            max_price[key] = max(max_price.get(key, 0), r["price"])

    def med(lists, window=3, min_n=MIN_TRADES):
        vals = []
        for i in range(n):
            pool = [x for j in range(max(0, i - window + 1), i + 1) for x in lists[j]]
            vals.append(float(np.median(pool)) if len(pool) >= min_n else None)
        return vals

    raw_idx = med(ratio_m)
    first = next((v for v in raw_idx if v), None)
    idx = [None if v is None else v / first * 100 for v in raw_idx] if first else [None] * n
    med84 = med(p84_m)
    jr = [(j / s) if j and s else None for j, s in zip(med(j_ppy_m), med(ppy_m), strict=True)]

    def ratio3(num, den):
        out = []
        for i in range(n):
            a = sum(num[max(0, i - 2): i + 1])
            b = sum(den[max(0, i - 2): i + 1])
            out.append(a / b if b >= 5 else None)
        return out

    nhr, dr = ratio3(hi_m, tot_m), ratio3(dn_m, tot_m)

    # 거시 지표
    rate_s = series_map(conn, "ecos.mortgage_rate")
    base_s = series_map(conn, "ecos.base_rate")
    cpi_s = series_map(conn, "ecos.cpi")
    m2_s = series_map(conn, "ecos.m2")

    def rate_at(d: date) -> float:
        v = asof(rate_s, d)
        if v is not None:
            return v
        b = asof(base_s, d)
        return b + 1.7 if b is not None else 4.0

    burden = [None if p is None else monthly_payment(p * LTV, rate_at(m)) / (income / 12) * 100 for p, m in zip(med84, months, strict=True)]
    pir = [None if p is None else p / income for p in med84]
    cpi0 = next((asof(cpi_s, m) for m in months if asof(cpi_s, m)), None)
    real = [None if v is None or not cpi0 or not asof(cpi_s, m) else v / (asof(cpi_s, m) / cpi0) for v, m in zip(idx, months, strict=True)]
    m20 = next((asof(m2_s, m) for m in months if asof(m2_s, m)), None)
    liq = [None if v is None or not m20 or not asof(m2_s, m) else v / (asof(m2_s, m) / m20) for v, m in zip(idx, months, strict=True)]

    hh = conn.execute(
        "select coalesce(sum(households), 0)::float8 as h from complexes where sgg_cd = %s and property_type = 'apt'", (sgg,)
    ).fetchone()["h"]
    turnover = [v / hh * 1000 if hh else None for v in vol]

    # 온도계 요인
    mom = [None if i < 3 or idx[i] is None or idx[i - 3] is None else idx[i] / idx[i - 3] - 1 for i in range(n)]
    v3 = rolling([float(v) for v in vol], 3, np.mean)
    v12 = rolling([float(v) for v in vol], 12, np.mean)
    vtrend = [None if a is None or not b else a / b - 1 for a, b in zip(v3, v12, strict=True)]
    factors = {"momentum": mom, "turnover": vtrend, "new_high": nhr, "decline": dr, "burden": burden}
    zs = {k: zscore_series(v) for k, v in factors.items()}
    temp, contrib = [], {k: [] for k, *_ in TEMP_FACTORS}
    for i in range(n):
        parts = {k: (sign * zs[k][i]) for k, _, sign in TEMP_FACTORS if zs[k][i] is not None}
        if len(parts) < 3:
            temp.append(None)
            for k in contrib:
                contrib[k].append(None)
            continue
        z = sum(parts.values()) / len(parts)
        temp.append(norm_cdf(z * 1.2) * 100)
        for k in contrib:
            contrib[k].append(parts.get(k))

    region = f"{sgg}00000"
    name = conn.execute(
        "select coalesce((select name from collect_targets where sgg_cd = %s), %s) as n", (sgg, sgg)
    ).fetchone()["n"].split()[-1]
    out = {
        f"idx.{sgg}": ("region", f"아파트 가격지수({name})", "시작월=100", idx),
        f"vol.{sgg}": ("region", f"아파트 매매 건수({name})", "건", [float(v) for v in vol]),
        f"med84.{sgg}": ("region", f"84㎡ 매매가 중위({name})", "만원", med84),
        f"jr.{sgg}": ("region", f"전세가율({name})", "비율", jr),
        f"nhr.{sgg}": ("indicator", f"신고가 비율({name})", "비율", nhr),
        f"dr.{sgg}": ("indicator", f"하락 거래 비율({name})", "비율", dr),
        f"ind.burden.{sgg}": ("indicator", f"월부담지수({name})", "%", burden),
        f"ind.pir.{sgg}": ("indicator", f"PIR({name})", "배", pir),
        f"ind.real.{sgg}": ("indicator", f"실질가격지수({name})", "시작월=100", real),
        f"ind.liq.{sgg}": ("indicator", f"유동성 대비 가격({name})", "시작월=100", liq),
        f"ind.turnover.{sgg}": ("indicator", f"거래 회전율({name})", "‰", turnover),
        f"ind.temp.{sgg}": ("indicator", f"시장 온도계({name})", "0~100", temp),
    }
    for k, label, _ in TEMP_FACTORS:
        out[f"ind.temp_c.{k}.{sgg}"] = ("indicator", f"온도계 요인: {label}({name})", "z", contrib[k])
    written = 0
    for code, (cat, title, unit, vals) in out.items():
        pts = [(m, float(v)) for m, v in zip(months, vals, strict=True) if v is not None and not math.isnan(v)]
        written += upsert_series(conn, code, {"name": title, "unit": unit, "freq": "M", "source": "myrealty"}, pts,
                                 category=cat, region_cd=region)

    # 공급압력(최신값만): 이 시군구 주소의 입주 예정(24개월) 세대 / 재고
    sgg_name = conn.execute("select name from collect_targets where sgg_cd = %s", (sgg,)).fetchone()
    if sgg_name and sgg_name["name"] and hh:
        sup = conn.execute(
            """select coalesce(sum(nullif(payload->>'households', '')::float8), 0) as h from events
               where kind = 'move_in' and starts_on between current_date and current_date + 730 and address like %s""",
            (f"%{sgg_name['name'].split()[-1]}%",),
        ).fetchone()["h"]
        written += upsert_series(conn, f"ind.supply.{sgg}", {"name": f"공급압력({name})", "unit": "%", "freq": "M",
                                                             "source": "myrealty"},
                                 [(month_start(today), sup / hh * 100)], category="indicator", region_cd=region)
    conn.commit()
    return {"sgg": sgg, "months": n, "values": written, "latest_temp": next((t for t in reversed(temp) if t is not None), None)}


def detect_rate_change(conn) -> dict:
    """기준금리 변경 → 이벤트 + 전 사용자 알림."""
    from ..alerts.rules import notify
    from ..jobs.events_job import upsert_event

    vals = conn.execute(
        "select period, value from series_values where code = 'ecos.base_rate' order by period desc limit 2"
    ).fetchall()
    if len(vals) < 2 or abs(vals[0]["value"] - vals[1]["value"]) < 1e-9:
        return {"changed": False}
    cur, prev = vals[0], vals[1]
    direction = "인상" if cur["value"] > prev["value"] else "인하"
    title = f"기준금리 {direction}: {prev['value']:.2f}% → {cur['value']:.2f}%"
    upsert_event(conn, {"source_key": f"rate:{cur['period']}", "kind": "rate_decision", "title": title,
                        "starts_on": cur["period"], "ends_on": None, "address": None, "payload": {}, "source_url": None})
    n = 0
    for u in conn.execute("select id from users where status = 'active'").fetchall():
        n += notify(conn, user_id=u["id"], item_id=None, kind="rate", priority=2, title=title,
                    body="대출 금리·월부담지수에 영향. 지표 화면에서 시나리오를 확인하세요.", url="/indicators",
                    dedupe_key=f"rate:{cur['period']}")
    conn.commit()
    return {"changed": True, "title": title, "notified": n}


TEMP_BANDS = [(20, "냉각"), (40, "약세"), (60, "중립"), (80, "강세"), (101, "과열")]


def temp_band(v: float) -> str:
    return next(label for lim, label in TEMP_BANDS if v < lim)


def temperature_alerts(conn) -> int:
    """온도계 구간이 바뀐 시군구 → 그 지역에 부동산이 있는 사용자에게 알림."""
    from ..alerts.rules import notify

    n = 0
    for s in conn.execute("select code, name, region_cd from series where code like 'ind.temp.%%'").fetchall():
        vals = conn.execute(
            "select period, value from series_values where code = %s order by period desc limit 2", (s["code"],)
        ).fetchall()
        if len(vals) < 2:
            continue
        b0, b1 = temp_band(vals[0]["value"]), temp_band(vals[1]["value"])
        if b0 == b1:
            continue
        sgg = s["code"].rsplit(".", 1)[-1]
        for u in conn.execute("select distinct user_id from watch_items where sgg_cd = %s", (sgg,)).fetchall():
            n += notify(conn, user_id=u["user_id"], item_id=None, kind="indicator",
                        title=f"{s['name']} {b1} → {b0} ({vals[0]['value']:.0f})",
                        body="시장 온도계 구간이 바뀌었습니다. 요인별 기여를 지표 화면에서 확인하세요.",
                        url=f"/indicators?sgg={sgg}", dedupe_key=f"temp:{sgg}:{vals[0]['period']}")
    conn.commit()
    return n


def compute_indicators(conn, today: date | None = None) -> dict:
    sggs = [r["sgg_cd"] for r in conn.execute("select sgg_cd from collect_targets where enabled order by sgg_cd")]
    results = [compute_region(conn, s, today) for s in sggs]
    return {"regions": results, "rate": detect_rate_change(conn), "temp_alerts": temperature_alerts(conn)}
