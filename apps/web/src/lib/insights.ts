// 거시·지역 지표 → 해석 문장 (서버·클라이언트 공용 순수 함수)
//
// 지표 화면의 "시장 해석" 카드. 숫자를 나열하지 않고, 금리 → 구매력 → 거래 → 가격으로 이어지는 흐름에서
// 지금 어떤 요인이 가격을 밀고 당기는지 규칙으로 판단해 근거 숫자와 함께 보여 준다(모델 호출 없음, 재현 가능).
// 임계값은 경험 규칙이며 투자 판단 근거가 아니다.

export type Point = [string, number];
export type SeriesMap = Record<string, Point[] | undefined>;

export type Insight = {
  key: string;
  /** 가격에 대한 방향: up = 상승 요인, down = 하락 요인, neutral = 참고 */
  tone: "up" | "down" | "neutral";
  title: string;
  detail: string;
};

const lastV = (p?: Point[]) => (p?.length ? p[p.length - 1][1] : null);

/** n 개월 전 값(월 시계열) */
function ago(p: Point[] | undefined, n: number): number | null {
  if (!p || p.length <= n) return null;
  return p[p.length - 1 - n][1];
}

function pctChange(p: Point[] | undefined, n: number): number | null {
  const a = ago(p, n);
  const b = lastV(p);
  return a && b !== null ? b / a - 1 : null;
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** 최근 값이 과거 분포에서 몇 분위인지(0~1) */
export function percentile(p: Point[] | undefined): number | null {
  if (!p || p.length < 12) return null;
  const v = p[p.length - 1][1];
  return p.filter(([, x]) => x <= v).length / p.length;
}

/** 원리금균등 월 상환액 비율 변화(금리 r0 → r1, 30년) */
export function paymentChange(r0: number, r1: number, years = 30): number {
  const pay = (r: number) => {
    const m = r / 100 / 12;
    const n = years * 12;
    return m <= 0 ? 1 / n : (m * (1 + m) ** n) / ((1 + m) ** n - 1);
  };
  return pay(r1) / pay(r0) - 1;
}

const pp = (x: number, d = 2) => `${x > 0 ? "+" : ""}${x.toFixed(d)}%p`;
const pct = (x: number, d = 1) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const ym = (d: string) => `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월`;

/**
 * @param s 거시 코드(ecos.*)와 지역 코드(접미사 없이: idx, vol, jr, nhr, dr, ind.burden, ind.real, ind.liq, ind.supply)
 */
export function marketInsights(s: SeriesMap): Insight[] {
  const out: Insight[] = [];

  // 1) 금리 → 월 상환 부담
  const mort = s["ecos.mortgage_rate"];
  const m0 = ago(mort, 6);
  const m1 = lastV(mort);
  if (m0 !== null && m1 !== null) {
    const d = m1 - m0;
    const pay = paymentChange(m0, m1);
    if (Math.abs(d) >= 0.2) {
      out.push({
        key: "rate",
        tone: d < 0 ? "up" : "down",
        title: d < 0 ? "대출 금리 하락 → 구매력 개선" : "대출 금리 상승 → 구매력 약화",
        detail: `주담대 금리(신규) ${m0.toFixed(2)}% → ${m1.toFixed(2)}% (6개월 ${pp(d)}). 같은 금액을 30년 원리금균등으로 빌리면 월 상환액이 ${pct(pay)} 달라집니다.`,
      });
    } else {
      out.push({ key: "rate", tone: "neutral", title: "대출 금리 보합", detail: `주담대 금리(신규) ${m1.toFixed(2)}%, 6개월 변화 ${pp(d)}.` });
    }
  }

  // 2) 시장금리가 말하는 다음 금리 방향(국고채 3년 − 기준금리)
  const bond = lastV(s["ecos.bond_3y"]);
  const base = lastV(s["ecos.base_rate"]);
  if (bond !== null && base !== null) {
    const spread = bond - base;
    if (spread <= -0.15) {
      out.push({
        key: "curve",
        tone: "up",
        title: "시장은 금리 인하를 예상",
        detail: `국고채 3년 ${bond.toFixed(2)}%가 기준금리 ${base.toFixed(2)}%보다 ${Math.abs(spread).toFixed(2)}%p 낮습니다. 대출 금리는 보통 시장금리를 몇 달 뒤따릅니다.`,
      });
    } else if (spread >= 0.5) {
      out.push({
        key: "curve",
        tone: "down",
        title: "시장금리가 기준금리보다 높음",
        detail: `국고채 3년 ${bond.toFixed(2)}% − 기준금리 ${base.toFixed(2)}% = ${spread.toFixed(2)}%p. 금리 인상 또는 인하 지연을 반영하는 모습입니다.`,
      });
    }
  }

  // 3) 부담 수준(월부담지수의 과거 분위)
  const burden = s["ind.burden"];
  const bq = percentile(burden);
  const bv = lastV(burden);
  if (bq !== null && bv !== null) {
    const years = Math.round((burden!.length / 12) * 10) / 10;
    if (bq >= 0.8) {
      out.push({ key: "burden", tone: "down", title: "소득 대비 부담이 과거 고점권", detail: `월부담지수 ${bv.toFixed(0)}% — 최근 ${years}년 중 상위 ${Math.round((1 - bq) * 100) || 1}% 수준. 소득·금리 여건상 추가 상승 여력이 제한될 수 있습니다.` });
    } else if (bq <= 0.3) {
      out.push({ key: "burden", tone: "up", title: "소득 대비 부담이 낮은 편", detail: `월부담지수 ${bv.toFixed(0)}% — 최근 ${years}년 중 하위 ${Math.round(bq * 100)}% 수준. 실수요가 들어오기 쉬운 여건입니다.` });
    }
  }

  // 4) 거래량은 가격보다 먼저 움직인다
  const vol = s["vol"];
  if (vol && vol.length >= 12) {
    const v3 = mean(vol.slice(-3).map(([, x]) => x));
    const v12 = mean(vol.slice(-12).map(([, x]) => x));
    const i3 = pctChange(s["idx"], 3);
    if (v3 && v12) {
      const r = v3 / v12;
      if (r >= 1.3) {
        out.push({
          key: "volume",
          tone: "up",
          title: i3 !== null && i3 < 0.01 ? "거래가 먼저 늘고 있음(가격 선행 신호)" : "거래 증가 동반 상승",
          detail: `최근 3개월 월평균 ${v3.toFixed(0)}건 — 1년 평균의 ${r.toFixed(1)}배${i3 !== null ? `, 가격지수 3개월 ${pct(i3)}` : ""}. 거래량 회복은 대개 가격 반등보다 앞섭니다.`,
        });
      } else if (r <= 0.7) {
        out.push({ key: "volume", tone: "down", title: "거래 위축", detail: `최근 3개월 월평균 ${v3.toFixed(0)}건 — 1년 평균의 ${r.toFixed(1)}배. 매수 관망이 길어지면 호가 조정으로 이어지기 쉽습니다.` });
      }
    }
  }

  // 5) 신고가·하락 거래 비율(가격 확산도)
  const nhr = lastV(s["nhr"]);
  const dr = lastV(s["dr"]);
  if (nhr !== null && nhr >= 0.2) {
    out.push({ key: "breadth", tone: "up", title: "신고가 거래 확산", detail: `최근 3개월 거래의 ${(nhr * 100).toFixed(0)}%가 같은 단지·면적 직전 최고가를 넘었습니다.` });
  } else if (dr !== null && dr >= 0.5) {
    out.push({ key: "breadth", tone: "down", title: "하락 거래 우세", detail: `최근 3개월 거래의 ${(dr * 100).toFixed(0)}%가 직전 거래보다 낮은 가격입니다.` });
  }

  // 6) 물가를 빼면 얼마나 올랐나(실질) + 고점 대비
  const real = s["ind.real"];
  const n12 = pctChange(s["idx"], 12);
  const r12 = pctChange(real, 12);
  if (real?.length && n12 !== null && r12 !== null) {
    const peak = real.reduce((a, b) => (b[1] > a[1] ? b : a));
    const fromPeak = real[real.length - 1][1] / peak[1] - 1;
    out.push({
      key: "real",
      tone: "neutral",
      title: fromPeak <= -0.1 ? `실질 가격은 고점(${ym(peak[0])}) 대비 ${pct(fromPeak, 0)}` : "물가 보정 후 가격",
      detail: `1년 명목 ${pct(n12)} 중 물가를 빼면 실질 ${pct(r12)}.${fromPeak <= -0.1 ? " 명목 가격이 전고점에 가까워도 구매력 기준으로는 아직 낮습니다." : ""}`,
    });
  }

  // 7) 풀린 돈(M2) 대비 가격
  const liq = s["ind.liq"];
  const m2y = pctChange(s["ecos.m2"], 12);
  if (liq?.length && m2y !== null) {
    const peak = liq.reduce((a, b) => (b[1] > a[1] ? b : a));
    const fromPeak = liq[liq.length - 1][1] / peak[1] - 1;
    if (fromPeak <= -0.15) {
      out.push({
        key: "liquidity",
        tone: "up",
        title: "통화량 대비 가격은 낮은 편",
        detail: `M2(광의통화)로 나눈 가격은 ${ym(peak[0])} 고점 대비 ${pct(fromPeak, 0)}. M2는 1년 ${pct(m2y)} 늘어 가격을 받쳐 주는 방향입니다.`,
      });
    } else if (fromPeak >= -0.03 && m2y < 0.04) {
      out.push({ key: "liquidity", tone: "down", title: "통화량보다 가격이 앞서 있음", detail: `M2 대비 가격이 고점권이고 M2 증가율은 1년 ${pct(m2y)}로 둔화했습니다.` });
    }
  }

  // 8) 전세가율: 갭과 매매 전환 압력, 역전세
  const jr = s["jr"];
  const j = lastV(jr);
  const j12 = ago(jr, 12);
  if (j !== null && j12 !== null) {
    const d = j - j12;
    if (d >= 0.02) {
      out.push({ key: "jeonse", tone: "up", title: "전세가율 상승 → 매매 전환 압력", detail: `전세가율 ${(j * 100).toFixed(1)}% (1년 ${pp(d * 100, 1)}). 매매와 전세의 차이(갭)가 줄면 전세 수요 일부가 매매로 옮겨 가기 쉽습니다.` });
    } else if (d <= -0.02) {
      out.push({ key: "jeonse", tone: "down", title: "전세가율 하락 → 역전세 주의", detail: `전세가율 ${(j * 100).toFixed(1)}% (1년 ${pp(d * 100, 1)}). 만기가 다가오는 임대인은 보증금 반환 자금을 점검하세요.` });
    }
  }

  // 9) 실거래 상세: 신규·갱신 전세 괴리, 법인 매수, 미등기 신고가, 직거래
  const jgap = lastV(s["jgap"]);
  const rrr = lastV(s["rrr"]);
  if (jgap !== null && jgap >= 0.08) {
    out.push({ key: "jgap", tone: "up", title: "신규 전세가 갱신보다 크게 비쌈", detail: `최근 3개월 신규 전세가 갱신 계약보다 ${pct(jgap)}${rrr !== null ? `, 갱신 중 ${(rrr * 100).toFixed(0)}%가 갱신요구권(5% 상한) 사용` : ""}. 새로 구하는 세입자의 부담이 커 전세 수요가 매매로 옮겨 가기 쉽습니다.` });
  } else if (jgap !== null && jgap <= -0.03) {
    out.push({ key: "jgap", tone: "down", title: "신규 전세가 갱신보다 낮음", detail: `최근 3개월 신규 전세가 갱신 계약보다 ${pct(jgap)}. 전세 시장이 약해 재계약보다 새 계약이 싸게 이뤄집니다.` });
  }
  const corp = s["corp"];
  const c1 = lastV(corp);
  const c12 = ago(corp, 12);
  if (c1 !== null && c12 !== null && c1 - c12 >= 0.03 && c1 >= 0.08) {
    out.push({ key: "corp", tone: "up", title: "법인 매수 증가", detail: `매매 중 법인 매수 비중 ${(c1 * 100).toFixed(0)}% (1년 ${pp((c1 - c12) * 100, 1)}). 투자 수요가 들어오는 신호이지만, 규제 변화에 민감한 수요입니다.` });
  }
  const unreg = lastV(s["unreg"]);
  if (unreg !== null && unreg >= 0.2) {
    out.push({ key: "unreg", tone: "neutral", title: "등기 안 된 신고가가 많음", detail: `계약 후 90일이 지나도 등기되지 않은 신고가가 ${(unreg * 100).toFixed(0)}%. 해제·허위 신고 가능성이 있어 신고가를 곧이곧대로 보기 어렵습니다.` });
  }
  const direct = lastV(s["direct"]);
  if (direct !== null && direct >= 0.15) {
    out.push({ key: "direct", tone: "neutral", title: "직거래 비중 높음", detail: `최근 3개월 매매의 ${(direct * 100).toFixed(0)}%가 직거래. 가족 간 거래 등 시세보다 낮은 거래가 섞여 중위가가 눌릴 수 있습니다.` });
  }

  // 10) 전국 수요 심리·신용·공급 파이프라인(수집되는 경우만)
  const csi = s["ecos.housing_csi"];
  const csiV = lastV(csi);
  if (csiV !== null) {
    const d3 = ago(csi, 3) !== null ? csiV - ago(csi, 3)! : null;
    if (csiV >= 110) out.push({ key: "csi", tone: "up", title: "집값 상승 기대 우세", detail: `주택가격전망 CSI ${csiV.toFixed(0)}(100 초과 = 오를 것이라는 응답이 많음)${d3 !== null ? `, 3개월 ${d3 >= 0 ? "+" : ""}${d3.toFixed(0)}` : ""}. 기대가 매수 수요로 이어지기 쉽습니다.` });
    else if (csiV <= 90) out.push({ key: "csi", tone: "down", title: "집값 하락 기대 우세", detail: `주택가격전망 CSI ${csiV.toFixed(0)}${d3 !== null ? `, 3개월 ${d3 >= 0 ? "+" : ""}${d3.toFixed(0)}` : ""}. 매수 관망이 길어질 수 있습니다.` });
  }
  const credit = pctChange(s["ecos.household_mortgage"], 12);
  if (credit !== null) {
    if (credit >= 0.06) out.push({ key: "credit", tone: "up", title: "주택담보대출이 빠르게 늘어남", detail: `주담대 잔액 1년 ${pct(credit)}. 대출로 들어오는 매수 자금이 많습니다(규제 강화 가능성도 함께 보세요).` });
    else if (credit <= 0.02) out.push({ key: "credit", tone: "down", title: "주택담보대출 증가 둔화", detail: `주담대 잔액 1년 ${pct(credit)}. 대출 규제·금리 부담으로 매수 자금이 덜 들어옵니다.` });
  }
  const sd = lastV(s["reb.supply_demand"]);
  if (sd !== null) {
    if (sd >= 100) out.push({ key: "supply_demand", tone: "up", title: "사려는 사람이 더 많음", detail: `아파트 매매수급지수 ${sd.toFixed(1)}(100 초과 = 매수자 우위).` });
    else if (sd <= 85) out.push({ key: "supply_demand", tone: "down", title: "팔려는 사람이 더 많음", detail: `아파트 매매수급지수 ${sd.toFixed(1)}(100 미만 = 매도자 우위).` });
  }
  const unsold = s["kosis.unsold_done"];
  const u12 = pctChange(unsold, 12);
  const uv = lastV(unsold);
  if (u12 !== null && uv !== null) {
    if (u12 >= 0.2) out.push({ key: "unsold", tone: "down", title: "준공 후 미분양 증가", detail: `다 짓고도 안 팔린 집 ${Math.round(uv).toLocaleString()}호(1년 ${pct(u12, 0)}). 건설사 할인 분양이 주변 시세를 누를 수 있습니다.` });
    else if (u12 <= -0.2) out.push({ key: "unsold", tone: "up", title: "준공 후 미분양 감소", detail: `다 짓고도 안 팔린 집 ${Math.round(uv).toLocaleString()}호(1년 ${pct(u12, 0)}). 재고가 소진되고 있습니다.` });
  }
  const permits = s["kosis.permits"];
  if (permits && permits.length >= 72) {
    const sum12 = (end: number) => permits.slice(end - 12, end).reduce((a, [, v]) => a + v, 0);
    const recent = sum12(permits.length);
    const past = [24, 36, 48, 60].map((k) => sum12(permits.length - k));
    const avg = past.reduce((a, b) => a + b, 0) / past.length;
    const r = avg ? recent / avg : null;
    if (r !== null && r <= 0.75) out.push({ key: "pipeline", tone: "up", title: "몇 년 뒤 공급 감소 예고", detail: `최근 1년 주택 인허가가 과거 평균의 ${(r * 100).toFixed(0)}%. 인허가는 보통 3~4년 뒤 입주로 이어져 그때 공급이 줄어듭니다.` });
    else if (r !== null && r >= 1.25) out.push({ key: "pipeline", tone: "down", title: "몇 년 뒤 공급 증가 예고", detail: `최근 1년 주택 인허가가 과거 평균의 ${(r * 100).toFixed(0)}%. 3~4년 뒤 입주 물량이 늘어납니다.` });
  }

  // 11) 입주 물량
  const sup = lastV(s["ind.supply"]);
  if (sup !== null && sup > 0) {
    if (sup >= 8) out.push({ key: "supply", tone: "down", title: "입주 물량 많음", detail: `향후 24개월 입주 예정이 재고의 ${sup.toFixed(1)}%. 입주 시기 전후로 전세·매매 가격이 눌릴 수 있습니다.` });
    else if (sup <= 2) out.push({ key: "supply", tone: "up", title: "입주 물량 적음", detail: `향후 24개월 입주 예정이 재고의 ${sup.toFixed(1)}%. 신규 공급이 적어 전세 가격을 받쳐 줍니다.` });
  }

  return out;
}

/** 요약 한 줄: 상승 요인 n · 하락 요인 m */
export function insightBalance(xs: Insight[]) {
  const up = xs.filter((x) => x.tone === "up").length;
  const down = xs.filter((x) => x.tone === "down").length;
  const verdict = up - down >= 2 ? "상승 요인이 우세" : down - up >= 2 ? "하락 요인이 우세" : "요인이 엇갈림";
  return { up, down, verdict };
}

export type RuleRecord = { id: string; key: string; tone: "up" | "down"; title: string; n: number; avgForward: number; hitRate: number };

/**
 * 해석 규칙 백테스트: 각 달에 그때까지의 데이터만으로 규칙을 돌리고, target(기본 idx) 가 horizon 개월 뒤 얼마나 바뀌었는지 본다.
 * hitRate = 상승 요인이면 뒤에 올랐던 비율, 하락 요인이면 내렸던 비율. 이웃한 달의 신호는 기간이 겹친다(참고용).
 */
export function backtestInsights(s: SeriesMap, opts: { target?: string; horizon?: number; warmup?: number } = {}) {
  const target = s[opts.target ?? "idx"];
  const horizon = opts.horizon ?? 6;
  const warmup = opts.warmup ?? 24;
  if (!target || target.length < warmup + horizon + 6) return null;
  const acc = new Map<string, RuleRecord & { sum: number; hits: number }>();
  let ups = 0;
  let total = 0;
  for (let i = warmup; i < target.length - horizon; i++) {
    const d = target[i][0];
    const fwd = target[i + horizon][1] / target[i][1] - 1;
    total += 1;
    ups += fwd > 0 ? 1 : 0;
    const cut: SeriesMap = Object.fromEntries(Object.entries(s).map(([k, p]) => [k, p?.filter(([x]) => x <= d)]));
    for (const x of marketInsights(cut)) {
      if (x.tone === "neutral") continue;
      const id = `${x.key}:${x.tone}`;
      const r = acc.get(id) ?? { id, key: x.key, tone: x.tone, title: x.title, n: 0, avgForward: 0, hitRate: 0, sum: 0, hits: 0 };
      r.n += 1;
      r.sum += fwd;
      r.hits += (x.tone === "up" ? fwd > 0 : fwd < 0) ? 1 : 0;
      acc.set(id, r);
    }
  }
  const rules: RuleRecord[] = [...acc.values()].map(({ sum, hits, ...r }) => ({ ...r, avgForward: sum / r.n, hitRate: hits / r.n }));
  return { horizon, months: total, baseUp: total ? ups / total : 0, rules: rules.sort((a, b) => b.n - a.n) };
}
