// 대출·전세 계산 (서버·클라이언트 공용, 단위: 만원)

/** 원리금균등 월 상환액 */
export function monthlyPayment(principal: number, annualRatePct: number, years: number) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (n <= 0) return 0;
  if (r <= 0) return principal / n;
  return (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1);
}

export type ScenarioInput = {
  price: number;
  ltv: number; // 0~1
  rate: number; // %
  years: number;
  incomeAnnual: number; // 만원
  otherDebtMonthly?: number; // 기타 대출 월 상환(만원)
};

export function scenario(i: ScenarioInput) {
  const loan = i.price * i.ltv;
  const pay = monthlyPayment(loan, i.rate, i.years);
  const dsr = ((pay + (i.otherDebtMonthly ?? 0)) * 12) / i.incomeAnnual;
  return { loan, equity: i.price - loan, monthly: pay, dsr, burden: (pay / (i.incomeAnnual / 12)) * 100 };
}

/**
 * 전세 보증금 위험 점검.
 * - 매매가 대비 보증금 비율(전세가율)
 * - 공시가격 × 126%(= 140% × 담보인정 90%, HUG 전세보증 가입 기준, 2023.5~) 대비
 * - 선순위 채권(근저당 등)을 더한 부채비율
 */
export function jeonseRisk(p: { deposit: number; marketPrice: number | null; officialPrice: number | null; seniorDebt?: number; guaranteeRatio?: number }) {
  const ratio = p.marketPrice ? (p.deposit + (p.seniorDebt ?? 0)) / p.marketPrice : null;
  const cap = p.officialPrice ? p.officialPrice * (p.guaranteeRatio ?? 1.26) : null;
  const overCap = cap !== null ? p.deposit + (p.seniorDebt ?? 0) - cap : null;
  let level: "안전" | "주의" | "위험" | "판단불가" = "판단불가";
  if (p.deposit <= 0) return { ratio, cap, overCap, level };
  if (ratio !== null) level = ratio >= 0.9 ? "위험" : ratio >= 0.8 ? "주의" : "안전";
  if (overCap !== null && overCap > 0) level = "위험";
  return { ratio, cap, overCap, level };
}
