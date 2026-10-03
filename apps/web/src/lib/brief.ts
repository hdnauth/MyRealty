// 부동산 한눈 요약: 누구나 묻는 다섯 질문(얼마 · 싼가 · 시장 흐름 · 자금 계획 · 위험)에 한 줄씩 답한다.
// 서버·클라이언트 공용 순수 함수(금액 단위 만원). 숫자는 이미 계산된 지표만 쓰고, 여기서는 문장과 판정만 만든다.
// 질문과 순서는 모두에게 같다. 사용자가 직접 넣은 정보(대출·보증금·내 자금)가 있을 때만 그 답이 그 정보를 반영한다.

import { monthlyPayment } from "./finance";
import { formatManwon, formatPct } from "./format";

/** 관심 부동산 그룹(보유·매수 후보·관심·전월세 거주) — 답의 말투를 바꾸지 않고, 어떤 계산을 할지만 정한다 */
export type ItemGroup = "owned" | "candidate" | "watch" | "tenant";
export type QuestionKey = "price" | "value" | "outlook" | "money" | "risk";
/** good/bad/warn: 안전·위험 판정, up/down: 가격 방향(빨강/파랑), empty: 답할 자료 없음 */
export type Tone = "good" | "bad" | "warn" | "up" | "down" | "neutral" | "empty";
/** 답의 근거가 있는 곳(화면이 링크로 바꾼다) */
export type Evidence = "price" | "compare" | "market" | "money" | "risk" | "edit";

export type Answer = {
  key: QuestionKey;
  q: string;
  headline: string;
  detail?: string;
  /** 판단을 얼마나 믿을 수 있는지(과거 적중률·표본 수 등) */
  trust?: string;
  tone: Tone;
  evidence?: Evidence;
  /** 답하려면 사용자가 넣어야 하는 정보 */
  need?: "finance-profile" | "item-finance" | "lease";
};

export type FinanceProfile = {
  /** 집 사는 데 쓸 수 있는 현금(만원) */
  cash: number | null;
  /** 가구 연소득(세전, 만원) */
  income: number | null;
  /** 담보인정비율(0~1) */
  ltv: number;
};

export const DEFAULT_LTV = 0.5;
export const LTV_OPTIONS = [0.4, 0.5, 0.6, 0.7, 0.8] as const;
/** 총부채원리금상환비율 한도(은행권 일반) */
export const DSR_LIMIT = 0.4;

export type MarketBrief = {
  region: string | null;
  verdict: string;
  up: number;
  down: number;
  /** 가격 방향 요인 제목(중요한 순) */
  reasons: string[];
  temp: number | null;
  tempLabel: string | null;
  /** 지금 켜진 신호들의 이 지역 과거 성적 */
  record?: SignalRecord | null;
};

export type SignalRecord = { hitRate: number; base: number; signals: number; months: number };

export type BriefInput = {
  group: ItemGroup;
  /** 단지형(아파트·오피스텔·빌라 단지) / 필지형(토지·임야·단독·상가) */
  kind: "complex" | "parcel";
  value: {
    current: number | null;
    low?: number | null;
    high?: number | null;
    confidence?: string | null;
    /** "추정 시세" · "6개월 거래 중위" 처럼 근거 */
    basis: string;
    /** 최근 1년 매매(유사 거래) 건수 */
    samples12m: number;
  };
  change1y: number | null;
  /** 현재가 ÷ 역대 최고가 − 1 (단지형만) */
  fromHigh: number | null;
  purchasePrice?: number | null;
  /** 유사 단지 대비 가격 위치(item-analytics relativeValue) */
  relative?: { z: number; current: number; average: number } | null;
  /** 최근 1년 변화: 내 단지 − 유사 단지 중위(%p 를 비율로) */
  compGap?: number | null;
  /** 토지·임야: 시세 ÷ 공시지가 총액 */
  officialMultiple?: number | null;
  market?: MarketBrief | null;
  /** 주담대(신규) 평균 금리(%) */
  rate: number;
  loans: { amount: number; rate: number; years?: number | null }[];
  lease?: { deposit: number; role: "landlord" | "tenant"; endDate?: string | null } | null;
  profile?: FinanceProfile | null;
  /** 이 단지·평형 전세 시세 점검(item-analytics jeonseCheck) */
  jeonse?: { current: number | null; gap: number | null; level: "양호" | "주의" | "위험" | "판단불가" } | null;
  /** 매매 시세(깡통전세 비율용, 없으면 value.current) */
  saleValue?: number | null;
  /** 공시가격(만원) — 전세보증보험 한도 */
  official?: number | null;
  flags?: {
    /** 토지거래허가구역 */
    permit?: boolean;
    /** 지역 미등기 신고가 비율(0~1) */
    unregistered?: number | null;
    /** 향후 24개월 입주 예정 / 재고(%) */
    supply?: number | null;
  };
};

export type Affordability = {
  price: number;
  costs: number;
  costRate: number;
  cash: number;
  need: number;
  ltvCap: number;
  dsrCap: number | null;
  cap: number;
  ok: boolean;
  short: number;
  monthly: number;
  incomeShare: number | null;
  maxPrice: number;
};

/** 취득세·지방교육세·중개보수를 합친 개략 비율(1주택 기준, 참고용) */
export function acquisitionCostRate(price: number) {
  if (price <= 60000) return 0.015;
  if (price <= 90000) return 0.025;
  return 0.038;
}

/** 월 상환 한도 → 빌릴 수 있는 원금(원리금균등) */
export function principalFor(monthly: number, ratePct: number, years: number) {
  const r = ratePct / 100 / 12;
  const n = years * 12;
  if (monthly <= 0 || n <= 0) return 0;
  if (r <= 0) return monthly * n;
  return (monthly * ((1 + r) ** n - 1)) / (r * (1 + r) ** n);
}

/**
 * 살 수 있나: 필요한 대출(가격 + 부대비용 − 현금)이 대출 한도(LTV 와 DSR 40% 중 작은 값) 안인지.
 * 스트레스 금리·지역별 대출 규제(한도 상한)는 반영하지 않는다 — 실제 한도는 더 낮을 수 있다.
 */
export function affordability(p: { price: number; cash: number; income: number | null; ltv: number; rate: number; years?: number }): Affordability {
  const years = p.years ?? 30;
  const costRate = acquisitionCostRate(p.price);
  const costs = Math.round(p.price * costRate);
  const need = Math.max(0, p.price + costs - p.cash);
  const ltvCap = p.price * p.ltv;
  const dsrCap = p.income ? principalFor((p.income * DSR_LIMIT) / 12, p.rate, years) : null;
  const cap = Math.max(0, dsrCap === null ? ltvCap : Math.min(ltvCap, dsrCap));
  const monthly = monthlyPayment(need, p.rate, years);
  // 이 현금·소득으로 살 수 있는 최대 가격: price(1 + c) − cash ≤ min(price·ltv, dsrCap)
  const byLtv = p.cash / Math.max(0.01, 1 + costRate - p.ltv);
  const byDsr = dsrCap === null ? Infinity : (p.cash + dsrCap) / (1 + costRate);
  return {
    price: p.price,
    costs,
    costRate,
    cash: p.cash,
    need,
    ltvCap,
    dsrCap,
    cap,
    ok: need <= cap,
    short: Math.max(0, need - cap),
    monthly,
    incomeShare: p.income ? (monthly * 12) / p.income : null,
    maxPrice: Math.round(Math.min(byLtv, byDsr)),
  };
}

const QUESTIONS: Record<QuestionKey, string> = {
  price: "지금 얼마?",
  value: "싼 편일까, 비싼 편일까?",
  outlook: "시장 흐름은?",
  money: "자금 계획은?",
  risk: "조심할 점은?",
};

/** 모두에게 같은 순서 */
export const QUESTION_ORDER: QuestionKey[] = ["price", "value", "outlook", "money", "risk"];

const q = (key: QuestionKey) => QUESTIONS[key];
const won = (v: number) => formatManwon(v, { short: true });
const pctAbs = (v: number, d = 0) => formatPct(Math.abs(v), d, false);
const join = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(" · ") || undefined;

function priceAnswer(i: BriefInput): Answer {
  const key = "price" as const;
  const v = i.value;
  if (!v.current) {
    return {
      key,
      q: q(key),
      tone: "empty",
      headline: "아직 시세를 낼 거래가 부족해요",
      detail: i.kind === "complex" ? "같은 단지·평형 거래가 쌓이면 매일 계산해요." : "주변 비슷한 거래가 쌓이면 매일 계산해요.",
      evidence: "price",
    };
  }
  const gain = i.purchasePrice && i.group !== "tenant" ? v.current - i.purchasePrice : null;
  return {
    key,
    q: q(key),
    tone: "neutral",
    headline: v.low && v.high && v.low < v.high ? `${won(v.current)} (${won(v.low)}~${won(v.high)})` : won(v.current),
    detail: join([
      v.basis,
      i.change1y !== null ? `1년 ${formatPct(i.change1y)}` : null,
      gain !== null && i.purchasePrice ? `매입가보다 ${gain >= 0 ? "+" : "−"}${won(Math.abs(gain))}(${formatPct(gain / i.purchasePrice)})` : null,
    ]),
    trust: v.samples12m < 3 ? `최근 1년 거래 ${v.samples12m}건 — 참고용` : v.confidence === "low" ? "추정 신뢰도 낮음 — 참고용" : undefined,
    evidence: "price",
  };
}

function valueAnswer(i: BriefInput): Answer {
  const key = "value" as const;
  const r = i.relative;
  if (r) {
    const cheap = r.z <= -1;
    const dear = r.z >= 1;
    return {
      key,
      q: q(key),
      tone: cheap ? "down" : dear ? "up" : "neutral",
      headline: cheap ? "비슷한 단지에 비해 평소보다 싼 편이에요" : dear ? "비슷한 단지에 비해 평소보다 비싼 편이에요" : "비슷한 단지와 비교해 평소 수준이에요",
      detail: `보통은 유사 단지보다 ${gapText(r.average)} 거래됐는데, 지금은 ${gapText(r.current)} 거래돼요`,
      trust: cheap ? "단지 고유의 악재(하자·재건축 지연 등)가 없는지 함께 보세요" : dear ? "호재가 먼저 반영됐는지 확인해 보세요" : undefined,
      evidence: "compare",
    };
  }
  if (i.compGap !== null && i.compGap !== undefined && Math.abs(i.compGap) >= 0.005) {
    return {
      key,
      q: q(key),
      tone: "neutral",
      headline: `최근 1년 유사 단지보다 ${pctAbs(i.compGap, 1)}p ${i.compGap > 0 ? "더 올랐어요" : "덜 올랐어요"}`,
      detail: "가격 격차의 과거 흐름을 보기엔 거래가 부족해 1년 변화로 비교했어요",
      evidence: "compare",
    };
  }
  if (i.kind === "parcel" && i.officialMultiple) {
    return {
      key,
      q: q(key),
      tone: "neutral",
      headline: `공시지가의 약 ${i.officialMultiple.toFixed(1)}배`,
      detail: "주변 비슷한 크기·지목 토지 거래로 본 값이에요. 도로 접면·모양에 따라 크게 달라요",
      evidence: "compare",
    };
  }
  if (i.fromHigh !== null) {
    const near = i.fromHigh > -0.03;
    return {
      key,
      q: q(key),
      tone: near ? "up" : "neutral",
      headline: near ? "역대 최고가 근처예요" : `역대 최고가보다 ${pctAbs(i.fromHigh)} 낮아요`,
      detail: "비슷한 단지와 비교할 거래가 부족해 이 단지 최고가와 비교했어요",
      evidence: "price",
    };
  }
  return { key, q: q(key), tone: "empty", headline: "비교할 거래가 아직 부족해요", evidence: "compare" };
}

/** 유사 단지 대비 격차 → "7% 비싸게" / "5% 싸게" / "비슷하게" */
function gapText(x: number) {
  if (Math.abs(x) < 0.005) return "비슷하게";
  return `${pctAbs(x, 0)} ${x > 0 ? "비싸게" : "싸게"}`;
}

function outlookAnswer(i: BriefInput): Answer {
  const key = "outlook" as const;
  const m = i.market;
  if (!m) {
    return {
      key,
      q: q(key),
      tone: "empty",
      headline: "이 지역 시장 지표는 아직 계산 전이에요",
      detail: "매일 수집 때 시군구 아파트 거래로 계산해요(거래가 적은 곳은 계산하지 않아요).",
      evidence: "market",
    };
  }
  const diff = m.up - m.down;
  const rec = m.record;
  return {
    key,
    q: q(key),
    tone: diff >= 2 ? "up" : diff <= -2 ? "down" : "neutral",
    headline: `${m.region ? `${m.region} ` : ""}${m.verdict}`,
    // 판정은 앞으로의 요인(금리·거래·공급…), 온도는 지금의 열기 — 둘이 엇갈릴 수 있어 이름을 나눈다
    detail: join([m.temp !== null && m.tempLabel ? `지금 시장 온도 ${Math.round(m.temp)}(${m.tempLabel})` : null, ...m.reasons.slice(0, 2)]),
    trust:
      rec && rec.signals > 0
        ? `지금 켜진 신호 ${rec.signals}개, 이 지역 과거 ${rec.months}개월 기준 6개월 뒤 방향 적중 ${pctAbs(rec.hitRate)} (무작정 찍으면 ${pctAbs(rec.base)})`
        : undefined,
    evidence: "market",
  };
}

function moneyAnswer(i: BriefInput): Answer {
  const key = "money" as const;
  const qq = q(key);
  const leaseTenant = i.lease?.role === "tenant" ? i.lease : null;
  // 1) 세 들어 사는 집: 보증금 ↔ 지금 전세 시세(재계약)
  if (leaseTenant || i.group === "tenant") {
    const j = i.jeonse?.current;
    const dep = leaseTenant?.deposit;
    if (!dep) return { key, q: qq, tone: "empty", headline: "보증금을 넣으면 재계약 시세와 비교해요", need: "lease", evidence: "edit" };
    if (!j) return { key, q: qq, tone: "empty", headline: "비교할 전세 거래가 아직 부족해요", evidence: "risk" };
    const d = j - dep;
    if (d > dep * 0.05) {
      return {
        key,
        q: qq,
        tone: "warn",
        headline: `전세 시세가 보증금보다 ${won(d)} 높아요`,
        detail: `재계약 때 인상 요구가 있을 수 있어요. 계약갱신요구권(1회)을 쓰면 5% 이내(최대 ${won(dep * 0.05)})로 2년 연장할 수 있어요`,
        evidence: "risk",
      };
    }
    if (d < -dep * 0.03) {
      // 재계약에는 유리하지만, 이사 나갈 때는 집주인이 새 보증금만으로 돌려주기 어렵다 — 좋다고만 할 수 없다
      return {
        key,
        q: qq,
        tone: "neutral",
        headline: `전세 시세가 보증금보다 ${won(-d)} 낮아요`,
        detail: "재계약 때 보증금을 낮출 여지가 있지만, 이사 나갈 때는 반환이 늦어질 수 있어요",
        evidence: "risk",
      };
    }
    return { key, q: qq, tone: "neutral", headline: "전세 시세와 보증금이 비슷해요", detail: `전세 시세 ${won(j)} · 보증금 ${won(dep)}`, evidence: "risk" };
  }
  // 2) 보유(또는 대출·받은 보증금을 넣은 집): 갚을 돈과 금리 부담
  const loans = i.loans.filter((l) => l.amount > 0);
  const held = i.lease?.role === "landlord" ? i.lease.deposit : 0; // 받은 보증금도 만기에 돌려줄 빚
  if (i.group === "owned" || loans.length || held) {
    if (!loans.length) {
      if (held) {
        const ratio = i.value.current ? held / i.value.current : null;
        return {
          key,
          q: qq,
          tone: ratio !== null && ratio >= 0.7 ? "warn" : "neutral",
          headline: `대출 없음 · 돌려줄 보증금 ${won(held)}`,
          detail: join([ratio !== null ? `시세의 ${pctAbs(ratio)}` : null, i.lease?.endDate ? `만기 ${i.lease.endDate}` : null, "만기에 새 보증금이나 자기 돈으로 돌려줘야 해요"]),
          evidence: "risk",
        };
      }
      if (!i.purchasePrice) return { key, q: qq, tone: "empty", headline: "매입·대출 정보를 넣으면 손익과 상환 부담을 계산해요", need: "item-finance", evidence: "edit" };
      return { key, q: qq, tone: "good", headline: "대출 없이 보유 중", evidence: "money" };
    }
    const total = loans.reduce((a, l) => a + l.amount, 0) + held;
    const pay = (dr: number) => loans.reduce((a, l) => a + monthlyPayment(l.amount, (l.rate || i.rate) + dr, l.years ?? 30), 0);
    const now = pay(0);
    const ltv = i.value.current ? total / i.value.current : null;
    return {
      key,
      q: qq,
      tone: ltv !== null && ltv >= 0.7 ? "warn" : "neutral",
      headline: `월 상환 약 ${won(now)}`,
      detail: join([`${held ? "대출+보증금" : "대출"} ${won(total)}${ltv !== null ? `(시세의 ${pctAbs(ltv)})` : ""}`, `금리 1%p 오르면 월 +${won(pay(1) - now)}`]),
      evidence: "money",
    };
  }
  // 3) 그 밖: 내 자금(가용 현금·연소득)으로 살 수 있나
  const price = i.value.current;
  const pr = i.profile;
  if (!price) return { key, q: qq, tone: "empty", headline: "시세가 나오면 자금 계획을 계산해요", evidence: "money" };
  if (!pr || pr.cash === null) {
    return { key, q: qq, tone: "empty", headline: "가용 현금·연소득을 넣으면 필요한 대출을 계산해요", detail: `${won(price)} 기준 · 부대비용·LTV·DSR 한도·월 상환`, need: "finance-profile", evidence: "money" };
  }
  const a = affordability({ price, cash: pr.cash, income: pr.income, ltv: pr.ltv, rate: i.rate });
  const dsrNote = pr.income ? null : "연소득을 넣으면 DSR 한도도 확인해요";
  if (a.need === 0) {
    return { key, q: qq, tone: "good", headline: "가용 현금으로 충분해요", detail: `부대비용(약 ${pctAbs(a.costRate, 1)}) 포함 · 남는 현금 ${won(a.cash - price - a.costs)}`, evidence: "money" };
  }
  if (a.ok) {
    return {
      key,
      q: qq,
      tone: "good",
      headline: `대출 약 ${won(a.need)}로 가능`,
      detail: join([`월 상환 약 ${won(a.monthly)}${a.incomeShare !== null ? `(소득의 ${pctAbs(a.incomeShare)})` : ""}`, `한도 약 ${won(a.cap)}`, dsrNote]),
      trust: "부대비용 포함 개략 계산 · 지역 규제·스트레스 금리로 실제 한도는 더 낮을 수 있어요",
      evidence: "money",
    };
  }
  return {
    key,
    q: qq,
    tone: "bad",
    headline: `대출 한도보다 약 ${won(a.short)} 부족`,
    detail: join([`필요 대출 ${won(a.need)} > 한도 ${won(a.cap)}`, `이 조건이면 약 ${won(a.maxPrice)}까지`, dsrNote]),
    trust: "부대비용 포함 개략 계산 · 실제 한도는 은행에서 확인하세요",
    evidence: "money",
  };
}

type Flag = { level: "bad" | "warn"; text: string; evidence: Evidence };

export function riskFlags(i: BriefInput): Flag[] {
  const out: Flag[] = [];
  const lease = i.lease;
  const tenant = lease?.role === "tenant";
  if (tenant && lease?.deposit) {
    const sale = i.saleValue ?? i.value.current;
    if (sale) {
      const r = lease.deposit / sale;
      if (r >= 0.8) out.push({ level: r >= 0.9 ? "bad" : "warn", text: `보증금이 집값의 ${pctAbs(r)} — 깡통전세 ${r >= 0.9 ? "위험" : "주의"}`, evidence: "risk" });
    }
    if (i.official) {
      const cap = i.official * 1.26;
      if (lease.deposit > cap) out.push({ level: "bad", text: `공시가격 기준 전세보증보험 한도(약 ${won(cap)})를 넘어요`, evidence: "risk" });
    }
    if (i.jeonse?.gap !== null && i.jeonse?.gap !== undefined && (i.jeonse.level === "위험" || i.jeonse.level === "주의")) {
      out.push({ level: i.jeonse.level === "위험" ? "bad" : "warn", text: `전세 시세가 보증금보다 ${won(-i.jeonse.gap)} 낮아 만기 반환이 늦어질 수 있어요`, evidence: "risk" });
    }
  }
  if (lease?.role === "landlord" && i.jeonse?.gap !== null && i.jeonse?.gap !== undefined && i.jeonse.gap < 0 && i.jeonse.level !== "양호") {
    out.push({ level: i.jeonse.level === "위험" ? "bad" : "warn", text: `역전세: 지금 시세로 새 세입자를 받으면 약 ${won(-i.jeonse.gap)}을 따로 마련해야 해요`, evidence: "risk" });
  }
  const loanTotal = i.loans.reduce((a, l) => a + (l.amount || 0), 0);
  if (loanTotal && i.value.current && loanTotal / i.value.current >= 0.7) {
    out.push({ level: "warn", text: `대출이 시세의 ${pctAbs(loanTotal / i.value.current)} — 가격이 내리면 부담이 커져요`, evidence: "money" });
  }
  if (i.change1y !== null && i.change1y <= -0.1) {
    out.push({ level: i.change1y <= -0.2 ? "bad" : "warn", text: `최근 1년 시세가 ${pctAbs(i.change1y)} 내렸어요 — 하락 이유(공급·노후·수요)를 확인하세요`, evidence: "price" });
  }
  const f = i.flags ?? {};
  if (f.permit) {
    out.push({
      level: "warn",
      text: "토지거래허가구역 — 사려면 허가가 필요하고 주택은 실거주만 가능해요(전세 낀 매수 불가)",
      evidence: "risk",
    });
  }
  if (i.value.current && i.value.samples12m < 3) {
    out.push({ level: "warn", text: `최근 1년 거래가 ${i.value.samples12m}건뿐이라 시세가 흔들릴 수 있어요`, evidence: "price" });
  }
  if (f.unregistered !== null && f.unregistered !== undefined && f.unregistered >= 0.2) {
    out.push({ level: "warn", text: `이 지역 신고가 중 ${pctAbs(f.unregistered)}가 아직 등기 전 — 신고가를 그대로 믿기 어려워요`, evidence: "market" });
  }
  if (f.supply !== null && f.supply !== undefined && f.supply >= 8) {
    out.push({ level: "warn", text: `앞으로 2년 입주 물량이 많아요(재고의 ${f.supply.toFixed(1)}%)`, evidence: "market" });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));
}

function riskAnswer(i: BriefInput): Answer {
  const key = "risk" as const;
  const qq = q(key);
  if (i.group === "tenant" && !i.lease?.deposit) {
    return { key, q: qq, tone: "empty", headline: "보증금을 넣으면 깡통전세·보증보험 한도를 점검해요", need: "lease", evidence: "edit" };
  }
  const flags = riskFlags(i);
  if (!flags.length) {
    return {
      key,
      q: qq,
      tone: "good",
      headline: "눈에 띄는 위험 신호는 없어요",
      detail: i.lease?.role === "tenant" ? "깡통전세 비율·보증보험 한도·전세 시세·규제·거래량을 점검했어요" : "규제·거래량·가격 변화·공급·미등기 신고가를 점검했어요",
      evidence: "risk",
    };
  }
  return {
    key,
    q: qq,
    tone: flags[0].level,
    headline: flags[0].text,
    detail: flags.length > 1 ? flags.slice(1, 3).map((x) => x.text).join(" · ") : undefined,
    evidence: flags[0].evidence,
  };
}

const BUILDERS: Record<QuestionKey, (i: BriefInput) => Answer> = {
  price: priceAnswer,
  value: valueAnswer,
  outlook: outlookAnswer,
  money: moneyAnswer,
  risk: riskAnswer,
};

/** 다섯 질문에 같은 순서로 답한다 */
export function buildBrief(i: BriefInput): Answer[] {
  return QUESTION_ORDER.map((k) => BUILDERS[k](i));
}

export function isItemGroup(v: unknown): v is ItemGroup {
  return v === "owned" || v === "candidate" || v === "watch" || v === "tenant";
}

/** users.settings.finance → 프로필(없거나 형식이 틀리면 null) */
export function readFinanceProfile(settings: Record<string, unknown> | null | undefined): FinanceProfile | null {
  const f = settings?.finance as Record<string, unknown> | undefined;
  if (!f || typeof f !== "object") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const ltv = typeof f.ltv === "number" && f.ltv > 0 && f.ltv <= 1 ? f.ltv : DEFAULT_LTV;
  const cash = num(f.cash);
  const income = num(f.income);
  if (cash === null && income === null) return null;
  return { cash, income, ltv };
}

// ───────── 눈여겨볼 지표 ─────────
// 실거래 세부 항목(층·계약구분·등기일자·매수자 구분)과 조합 지표 중, 이 부동산·지역에서 평소와 다르게 나타나는 것만 고른다.

type Pt = [string, number];

export type RegionSignals = {
  /** 최근 3개월 신규 전세 ÷ 갱신 전세 − 1 */
  jgap: number | null;
  /** 갱신 계약 중 갱신요구권 사용 비율 */
  rrr: number | null;
  corp: number | null;
  corpChange: number | null;
  unreg: number | null;
  direct: number | null;
  realFromPeak: number | null;
  realPeak: string | null;
  nominal1y: number | null;
  real1y: number | null;
  burdenPct: number | null;
  burdenYears: number | null;
};

const lastOf = (p?: Pt[]) => (p?.length ? p[p.length - 1][1] : null);
const agoOf = (p: Pt[] | undefined, n: number) => (p && p.length > n ? p[p.length - 1 - n][1] : null);

/** 지역 지표 시계열(접미사 없는 키: jgap, rrr, corp, unreg, direct, idx, ind.real, ind.burden) → 신호 재료 */
export function regionSignals(s: Record<string, Pt[] | undefined>): RegionSignals {
  const real = s["ind.real"];
  const peak = real?.length ? real.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
  const realNow = lastOf(real);
  const idx = s.idx;
  const burden = s["ind.burden"];
  const bNow = lastOf(burden);
  const corp = lastOf(s.corp);
  const corp12 = agoOf(s.corp, 12);
  const i12 = agoOf(idx, 12);
  const r12 = agoOf(real, 12);
  return {
    jgap: lastOf(s.jgap),
    rrr: lastOf(s.rrr),
    corp,
    corpChange: corp !== null && corp12 !== null ? corp - corp12 : null,
    unreg: lastOf(s.unreg),
    direct: lastOf(s.direct),
    realFromPeak: peak && realNow !== null ? realNow / peak[1] - 1 : null,
    realPeak: peak?.[0] ?? null,
    nominal1y: i12 && lastOf(idx) !== null ? lastOf(idx)! / i12 - 1 : null,
    real1y: r12 && realNow !== null ? realNow / r12 - 1 : null,
    burdenPct: burden && burden.length >= 12 && bNow !== null ? burden.filter(([, x]) => x <= bNow).length / burden.length : null,
    burdenYears: burden?.length ? Math.round((burden.length / 12) * 10) / 10 : null,
  };
}

export type Signal = {
  key: string;
  label: string;
  value: string;
  note: string;
  /** 어느 공공데이터 항목에서 나왔나 */
  source: string;
  tone: "up" | "down" | "warn" | "neutral";
  /** 얼마나 평소와 다른가(정렬용) */
  score: number;
};

export type SignalInput = {
  /** 같은 평형 층별 가격 차이(같은 시기 거래 대비) */
  floors?: { mine: { label: string; premium: number; n: number } | null; low: number | null; high: number | null } | null;
  /** 이 단지·평형 최근 6개월 신규·갱신 전세 중위와 건수 */
  jeonseContracts?: { newMedian: number | null; renewalMedian: number | null; newN?: number; renewalN?: number } | null;
  region?: (RegionSignals & { name: string | null }) | null;
};

/** 신규·갱신 전세를 비교하려면 각각 이만큼은 있어야 한다(작은 단지는 한두 건으로 크게 흔들린다) */
const MIN_CONTRACTS = 3;
/** 지역 공통 지표는 같은 시군구 모든 집에 똑같이 나오므로, 이 집에만 해당하는 지표(층·단지 전세)보다 뒤에 둔다 */
const REGION_WEIGHT = 0.6;

/** 눈여겨볼 지표: 평소와 다른 정도가 큰 순으로 최대 limit 개 */
export function notableSignals(i: SignalInput, limit = 4): Signal[] {
  const out: Signal[] = [];
  const f = i.floors;
  if (f?.mine && Math.abs(f.mine.premium) >= 0.03) {
    out.push({
      key: "floor",
      label: `이 집 층(${f.mine.label}) 가격 차이`,
      value: formatPct(f.mine.premium),
      note: `같은 평형을 같은 시기 거래와 비교 · 최근 3년 ${f.mine.n}건`,
      source: "실거래 층 정보",
      tone: f.mine.premium > 0 ? "up" : "down",
      score: Math.abs(f.mine.premium) * 10,
    });
  } else if (f && f.low !== null && f.high !== null && f.high - f.low >= 0.05) {
    out.push({
      key: "floor",
      label: "층에 따른 가격 차이",
      value: `저층 ${formatPct(f.low)} · 고층 ${formatPct(f.high)}`,
      note: "같은 평형을 같은 시기 거래와 비교 · 최근 3년",
      source: "실거래 층 정보",
      tone: "neutral",
      score: (f.high - f.low) * 8,
    });
  }
  const jc = i.jeonseContracts;
  const r = i.region;
  const where = r?.name ? `${r.name} ` : "";
  const enough = (jc?.newN ?? MIN_CONTRACTS) >= MIN_CONTRACTS && (jc?.renewalN ?? MIN_CONTRACTS) >= MIN_CONTRACTS;
  if (jc?.newMedian && jc.renewalMedian && enough && Math.abs(jc.newMedian / jc.renewalMedian - 1) >= 0.05) {
    const g = jc.newMedian / jc.renewalMedian - 1;
    out.push({
      key: "jgap",
      label: "신규 전세 vs 갱신 전세",
      value: formatPct(g),
      note: `${g > 0 ? `새로 들어가는 전세(${won(jc.newMedian)})가 재계약(${won(jc.renewalMedian)})보다 비싸요 — 전세 수요가 강한 편` : `새 계약(${won(jc.newMedian)})이 재계약(${won(jc.renewalMedian)})보다 싸요 — 전세가 약한 편`}${jc.newN ? ` · 최근 6개월 ${jc.newN + (jc.renewalN ?? 0)}건` : ""}`,
      source: "전월세 계약구분(신규·갱신)",
      tone: g > 0 ? "up" : "down",
      score: Math.abs(g) * 8,
    });
  } else if (r?.jgap !== null && r?.jgap !== undefined && Math.abs(r.jgap) >= 0.05) {
    out.push({
      key: "jgap",
      label: `${where}신규 vs 갱신 전세`,
      value: formatPct(r.jgap),
      note: `최근 3개월 시군구 기준${r.rrr !== null ? ` · 갱신 중 ${pctAbs(r.rrr)}가 갱신요구권(5% 상한) 사용` : ""}`,
      source: "전월세 계약구분(신규·갱신)",
      tone: r.jgap > 0 ? "up" : "down",
      score: Math.abs(r.jgap) * 8 * REGION_WEIGHT,
    });
  }
  if (r?.unreg !== null && r?.unreg !== undefined && r.unreg >= 0.1) {
    out.push({
      key: "unreg",
      label: `${where}등기 안 된 신고가`,
      value: pctAbs(r.unreg),
      note: "계약 후 90일이 지나도 등기가 없는 신고가 비율 — 해제·허위 신고 가능성",
      source: "실거래 등기일자",
      tone: "warn",
      score: r.unreg * 5 * REGION_WEIGHT,
    });
  }
  if (r?.corp !== null && r?.corp !== undefined && r.corp >= 0.05 && (r.corpChange ?? 0) >= 0.02) {
    out.push({
      key: "corp",
      label: `${where}법인 매수 비중`,
      value: pctAbs(r.corp),
      note: `1년 전보다 +${pctAbs(r.corpChange ?? 0, 1)}p — 투자 수요가 들어오는 신호(규제에 민감)`,
      source: "실거래 매수자 구분",
      tone: "warn",
      score: (r.corpChange ?? 0) * 12 * REGION_WEIGHT,
    });
  }
  if (r?.direct !== null && r?.direct !== undefined && r.direct >= 0.12) {
    out.push({
      key: "direct",
      label: `${where}직거래 비중`,
      value: pctAbs(r.direct),
      note: "가족 간 거래 등 시세보다 낮은 거래가 섞여 중위가가 눌릴 수 있어요",
      source: "실거래 거래유형",
      tone: "neutral",
      score: r.direct * 3 * REGION_WEIGHT,
    });
  }
  if (r?.realFromPeak !== null && r?.realFromPeak !== undefined && r.realFromPeak <= -0.1) {
    out.push({
      key: "real",
      label: `${where}물가 반영 실질 가격`,
      value: `고점 대비 ${formatPct(r.realFromPeak, 0)}`,
      note: join([r.realPeak ? `고점 ${r.realPeak.slice(0, 7)}` : null, r.nominal1y !== null ? `명목 1년 ${formatPct(r.nominal1y)}` : null, r.real1y !== null ? `실질 1년 ${formatPct(r.real1y)}` : null]) ?? "",
      source: "자체 가격지수 ÷ 소비자물가",
      tone: "down",
      score: Math.abs(r.realFromPeak) * 4 * REGION_WEIGHT,
    });
  }
  if (r?.burdenPct !== null && r?.burdenPct !== undefined && (r.burdenPct >= 0.8 || r.burdenPct <= 0.3)) {
    const high = r.burdenPct >= 0.8;
    out.push({
      key: "burden",
      label: `${where}소득 대비 월 상환 부담`,
      value: high ? `최근 ${r.burdenYears}년 중 상위 ${Math.max(1, Math.round((1 - r.burdenPct) * 100))}%` : `최근 ${r.burdenYears}년 중 하위 ${Math.round(r.burdenPct * 100)}%`,
      note: "84㎡ 중위가를 지금 금리로 빌렸을 때 월 상환 ÷ 가구 월소득",
      source: "실거래 · 한국은행 금리 · 통계청 소득",
      tone: high ? "up" : "down",
      score: Math.abs(r.burdenPct - 0.5) * 2 * REGION_WEIGHT,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
