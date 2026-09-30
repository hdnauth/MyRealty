"""입지 점수 검증 — 점수가 실제 가격 차이를 설명하는지, 가중치가 데이터와 맞는지 점검한다.

1. 점수가 있는 아파트 단지마다 최근 24개월 매매 ㎡당 가격 중위(시군구 자체 지수로 현재 시점 환산)를 구한다.
2. 시군구 평균을 빼서(고정효과) 지역 간 가격 수준 차이를 없애고, 같은 시군구 안의 차이만 본다.
3. log(㎡당 가격) ~ 항목별 점수 + 연식 을 릿지 회귀(표준화)로 적합한다.
   - 설명력(R²): 총점 하나 + 연식 / 항목별 + 연식
   - 항목별 효과: 점수 +10점일 때 가격 변화(%)
   - 데이터가 가리키는 가중치: 양(+)의 점당 효과 비례, 표본이 적으면 현재 가중치 쪽으로 당긴다(n/(n+200))
4. 점수 분포(p10·중위·p90·표준편차)로 변별력을 점검한다.

결과는 location_calibrations 에 쌓고, 가중치는 자동으로 바꾸지 않는다(참고·검토용).
"""

from __future__ import annotations

import logging
import math
from datetime import date

import numpy as np

from ..db import jsonb
from .location import SPECS

log = logging.getLogger(__name__)

MIN_COMPLEXES = 30
SHRINK_N0 = 200
RIDGE = 1.0

DATA_SQL = """
with tx as (
  select t.complex_id, t.price::float8 / t.area_m2::float8 as ppm2, t.deal_date, c.sgg_cd
  from transactions t join complexes c on c.id = t.complex_id
  where t.deal_kind = 'sale' and not t.is_canceled and t.price > 0 and t.area_m2 > 0
    and t.deal_date >= current_date - make_interval(months => %(months)s)
    and c.property_type = 'apt'
), idx as (
  select code, period, value, max(period) over (partition by code) as last_period from series_values
  where code like 'idx.%%'
), adj as (
  select tx.complex_id, tx.sgg_cd,
    tx.ppm2 * coalesce(il.value / nullif(im.value, 0), 1) as ppm2
  from tx
  left join idx im on im.code = 'idx.' || tx.sgg_cd and im.period = date_trunc('month', tx.deal_date)::date
  left join idx il on il.code = 'idx.' || tx.sgg_cd and il.period = il.last_period
)
select a.complex_id, a.sgg_cd, count(*) as n_tx,
  percentile_cont(0.5) within group (order by a.ppm2)::float8 as ppm2,
  c.build_year, l.total, l.scores
from adj a
join complexes c on c.id = a.complex_id
join location_scores l on l.target_type = 'complex' and l.target_id = a.complex_id::text
where l.total is not null
group by a.complex_id, a.sgg_cd, c.build_year, l.total, l.scores
having count(*) >= %(min_tx)s
"""


def _demean(x: np.ndarray, groups: list[str]) -> np.ndarray:
    out = x.astype(float).copy()
    g = np.array(groups)
    for key in set(groups):
        m = g == key
        out[m] -= out[m].mean(axis=0)
    return out


def _ridge(x: np.ndarray, y: np.ndarray, lam: float = RIDGE) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """표준화한 x 로 릿지 적합 → (원 단위 계수, 표준화 계수, 표준편차, R²)."""
    sd = x.std(axis=0)
    sd[sd == 0] = 1.0
    z = x / sd
    beta_z = np.linalg.solve(z.T @ z + lam * np.eye(z.shape[1]), z.T @ y)
    resid = y - z @ beta_z
    ss_tot = float((y ** 2).sum())
    r2 = 1 - float((resid ** 2).sum()) / ss_tot if ss_tot > 0 else 0.0
    return beta_z / sd, beta_z, sd, r2


def spread(values: list[float]) -> dict | None:
    v = np.array([x for x in values if x is not None], dtype=float)
    if not len(v):
        return None
    p10, p50, p90 = np.percentile(v, [10, 50, 90])
    return {"n": len(v), "p10": round(float(p10), 1), "p50": round(float(p50), 1), "p90": round(float(p90), 1),
            "std": round(float(v.std()), 1)}


def fit(rows: list[dict], cats: list[str] | None = None) -> dict | None:
    """rows: {sgg_cd, ppm2, build_year, total, scores} 목록 → 회귀 결과(표본이 모자라면 None)."""
    cats = cats or list(SPECS)
    # 항목이 20% 넘게 비어 있으면(미수집) 회귀에서 뺀다. 나머지 빈 값은 그 시군구 평균으로 채운다(demean 후 0)
    usable = [k for k in cats
              if sum(1 for r in rows if (r["scores"].get(k) or {}).get("score") is not None) >= 0.8 * len(rows)]
    rows = [r for r in rows if r["ppm2"] and r["ppm2"] > 0]
    if len(rows) < MIN_COMPLEXES or not usable:
        return None
    this_year = date.today().year
    ages = [this_year - r["build_year"] for r in rows if r["build_year"]]
    age_fill = float(np.median(ages)) if ages else 15.0
    groups = [r["sgg_cd"] for r in rows]
    y = _demean(np.log([r["ppm2"] for r in rows]), groups)

    def col(k: str) -> list[float]:
        vals = [(r["scores"].get(k) or {}).get("score") for r in rows]
        known = [v for v in vals if v is not None]
        fill = float(np.mean(known)) if known else 0.0
        return [fill if v is None else float(v) for v in vals]

    age = [float(this_year - r["build_year"]) if r["build_year"] else age_fill for r in rows]
    x_total = _demean(np.column_stack([[float(r["total"]) for r in rows], age]), groups)
    x_cats = _demean(np.column_stack([col(k) for k in usable] + [age]), groups)
    b_tot, _, _, r2_total = _ridge(x_total, y)
    b_cat, bz_cat, _, r2_cats = _ridge(x_cats, y)
    _, _, _, r2_age = _ridge(x_total[:, 1:], y)

    effects = {}
    for i, k in enumerate(usable):
        effects[k] = {"label": SPECS[k][0], "per10_pct": round((math.exp(float(b_cat[i]) * 10) - 1) * 100, 2),
                      "std_beta": round(float(bz_cat[i]), 4), "weight_now": SPECS[k][1]}
    pos = {k: max(float(b_cat[i]), 0.0) for i, k in enumerate(usable)}
    s_pos = sum(pos.values())
    now_sum = sum(SPECS[k][1] for k in usable)
    n = len(rows)
    shrink = n / (n + SHRINK_N0)
    for k in usable:
        w_now = SPECS[k][1] / now_sum
        w_fit = pos[k] / s_pos if s_pos > 0 else w_now
        effects[k]["weight_fit"] = round(w_fit, 3)
        effects[k]["weight_suggest"] = round(shrink * w_fit + (1 - shrink) * w_now, 3)
    return {
        "n": n, "sggs": len(set(groups)), "shrink": round(shrink, 3),
        "r2_age_only": round(r2_age, 3), "r2_total": round(r2_total, 3), "r2_categories": round(r2_cats, 3),
        "total_per10_pct": round((math.exp(float(b_tot[0]) * 10) - 1) * 100, 2),
        "age_per_year_pct": round((math.exp(float(b_cat[-1])) - 1) * 100, 2),
        "effects": effects,
    }


def calibrate_locations(conn, months: int = 24, min_tx: int = 3) -> dict:
    rows = [dict(r) for r in conn.execute(DATA_SQL, {"months": months, "min_tx": min_tx}).fetchall()]
    all_scores = conn.execute("select total, scores from location_scores where total is not null").fetchall()
    dist = {"total": spread([r["total"] for r in all_scores])}
    for k in SPECS:
        dist[k] = spread([(r["scores"].get(k) or {}).get("score") for r in all_scores])
    result = fit(rows)
    out = {"status": "ok" if result else "insufficient", "months": months, "min_tx": min_tx,
           "complexes_with_price": len(rows), "min_complexes": MIN_COMPLEXES, "spread": dist, **(result or {})}
    conn.execute("insert into location_calibrations (n, result) values (%s, %s)", (len(rows), jsonb(out)))
    # 오래된 기록은 90개만 남긴다
    conn.execute("""delete from location_calibrations where id not in
                    (select id from location_calibrations order by computed_at desc, id desc limit 90)""")
    conn.commit()
    if result:
        log.info("입지 점수 검증: 단지 %d곳, R² 총점 %.2f / 항목별 %.2f (연식만 %.2f)",
                 result["n"], result["r2_total"], result["r2_categories"], result["r2_age_only"])
    else:
        log.info("입지 점수 검증: 가격이 있는 단지 %d곳 — %d곳 이상 필요", len(rows), MIN_COMPLEXES)
    return {k: out[k] for k in ("status", "complexes_with_price") if k in out} | (
        {"r2_total": out["r2_total"], "r2_categories": out["r2_categories"]} if result else {})
