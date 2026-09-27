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

  // 9) 입주 물량
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
