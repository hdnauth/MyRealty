import { describe, expect, it } from "vitest";
import {
  acquisitionCostRate,
  affordability,
  type BriefInput,
  buildBrief,
  notableSignals,
  principalFor,
  QUESTION_ORDER,
  readFinanceProfile,
  regionSignals,
  riskFlags,
} from "../brief";
import { monthlyPayment } from "../finance";
import { rankInsights, signalRecord, type Insight } from "../insights";

const base = (o: Partial<BriefInput> = {}): BriefInput => ({
  group: "watch",
  kind: "complex",
  value: { current: 80000, low: 76000, high: 84000, confidence: "medium", basis: "추정 시세", samples12m: 12 },
  change1y: 0.05,
  fromHigh: -0.08,
  rate: 4,
  loans: [],
  market: { region: "영통구", verdict: "상승 요인이 우세", up: 3, down: 1, reasons: ["거래 증가", "금리 하락"], temp: 62, tempLabel: "강세", record: { hitRate: 0.64, base: 0.52, signals: 2, months: 30 } },
  ...o,
});
const answer = (o: Partial<BriefInput>, key: string) => buildBrief(base(o)).find((x) => x.key === key)!;

describe("다섯 질문(모두 같은 질문·순서)", () => {
  it("그룹과 상관없이 같은 질문을 같은 순서로", () => {
    for (const group of ["owned", "candidate", "watch", "tenant"] as const) {
      const a = buildBrief(base({ group }));
      expect(a.map((x) => x.key)).toEqual(QUESTION_ORDER);
      expect(a.map((x) => x.q)).toEqual(["지금 얼마?", "싼 편일까, 비싼 편일까?", "시장 흐름은?", "자금 계획은?", "조심할 점은?"]);
    }
  });

  it("매입가를 넣었으면 시세 답에 손익을 붙인다", () => {
    const a = answer({ group: "owned", purchasePrice: 60000 }, "price");
    expect(a.headline).toBe("8억 (7.6억~8.4억)");
    expect(a.detail).toContain("매입가보다 +2억(+33.3%)");
  });

  it("거래가 적으면 참고용, 시세가 없으면 빈 답", () => {
    expect(answer({ value: { current: 80000, basis: "x", samples12m: 1 } }, "price").trust).toContain("참고용");
    expect(answer({ value: { current: null, basis: "x", samples12m: 0 } }, "price").tone).toBe("empty");
  });

  it("시장 흐름: 판정 + 과거 적중률(기준선과 함께)", () => {
    const a = answer({}, "outlook");
    expect(a.headline).toBe("영통구 상승 요인이 우세");
    expect(a.tone).toBe("up");
    expect(a.detail).toContain("지금 시장 온도 62(강세)");
    expect(a.trust).toContain("64%");
    expect(a.trust).toContain("52%");
    expect(answer({ market: null }, "outlook").tone).toBe("empty");
  });
});

describe("싼가 비싼가", () => {
  it("유사 단지 대비 평소 격차와 비교(색은 가격 방향)", () => {
    const a = answer({ relative: { z: -1.4, current: -0.06, average: 0.02 } }, "value");
    expect(a.tone).toBe("down");
    expect(a.headline).toContain("평소보다 싼 편");
    expect(a.detail).toBe("보통은 유사 단지보다 2% 비싸게 거래됐는데, 지금은 6% 싸게 거래돼요");
    expect(answer({ relative: { z: 1.2, current: 0.39, average: 0.2 } }, "value").tone).toBe("up");
  });

  it("비교 자료가 없으면 1년 변화 격차 → 전고점 순으로 대체", () => {
    expect(answer({ compGap: 0.03 }, "value").headline).toContain("3.0%p 더 올랐어요");
    expect(answer({ fromHigh: -0.01 }, "value").headline).toBe("역대 최고가 근처예요");
  });

  it("토지는 공시지가 배율", () => {
    expect(answer({ kind: "parcel", fromHigh: null, officialMultiple: 1.84 }, "value").headline).toBe("공시지가의 약 1.8배");
  });
});

describe("자금 계획(넣은 정보에 따라)", () => {
  it("원리금 역산은 월 상환 공식과 맞는다", () => {
    expect(monthlyPayment(principalFor(200, 4, 30), 4, 30)).toBeCloseTo(200, 6);
  });

  it("부대비용 비율은 가격 구간별", () => {
    expect(acquisitionCostRate(50000)).toBe(0.015);
    expect(acquisitionCostRate(80000)).toBe(0.025);
    expect(acquisitionCostRate(120000)).toBe(0.038);
  });

  it("필요 대출이 LTV·DSR 한도 안인지, 최대 가격", () => {
    const a = affordability({ price: 80000, cash: 40000, income: 9000, ltv: 0.5, rate: 4 });
    expect(a.costs).toBe(2000);
    expect(a.need).toBe(42000);
    expect(a.ltvCap).toBe(40000);
    expect(a.ok).toBe(false);
    expect(a.short).toBe(2000);
    const m = affordability({ price: a.maxPrice, cash: 40000, income: 9000, ltv: 0.5, rate: 4 });
    expect(Math.abs(m.need - m.cap)).toBeLessThan(m.price * 0.02);
  });

  it("자금 정보가 없으면 입력 요청, 있으면 판정", () => {
    expect(answer({}, "money").need).toBe("finance-profile");
    expect(answer({ profile: { cash: 50000, income: 12000, ltv: 0.5 } }, "money").headline).toMatch(/^대출 약 .+로 가능$/);
    const bad = answer({ profile: { cash: 10000, income: 5000, ltv: 0.5 } }, "money");
    expect(bad.tone).toBe("bad");
    expect(bad.headline).toMatch(/^대출 한도보다 약 .+ 부족$/);
    expect(answer({ profile: { cash: 100000, income: null, ltv: 0.5 } }, "money").headline).toBe("가용 현금으로 충분해요");
  });

  it("대출을 넣었으면 그룹과 상관없이 상환 부담", () => {
    const a = answer({ loans: [{ amount: 60000, rate: 3.8, years: 30 }] }, "money");
    expect(a.headline).toBe(`월 상환 약 ${Math.round(monthlyPayment(60000, 3.8, 30)).toLocaleString("ko-KR")}만`);
    expect(a.tone).toBe("warn"); // 6억 / 8억 = 75%
    expect(a.detail).toContain("금리 1%p 오르면");
    expect(answer({ group: "owned" }, "money").need).toBe("item-finance");
  });

  it("세 놓은 집: 받은 보증금을 부담에 넣는다", () => {
    const a = answer({ group: "owned", purchasePrice: 50000, lease: { deposit: 60000, role: "landlord" } }, "money");
    expect(a.headline).toBe("대출 없음 · 돌려줄 보증금 6억");
    expect(a.tone).toBe("warn");
  });

  it("세 들어 사는 집: 보증금 ↔ 전세 시세", () => {
    const up = answer({ lease: { deposit: 40000, role: "tenant" }, jeonse: { current: 46000, gap: 6000, level: "양호" } }, "money");
    expect(up.headline).toBe("전세 시세가 보증금보다 6,000만 높아요");
    expect(up.detail).toContain("2,000만");
    const down = answer({ lease: { deposit: 40000, role: "tenant" }, jeonse: { current: 36000, gap: -4000, level: "위험" } }, "money");
    expect(down.tone).toBe("neutral");
    expect(down.detail).toContain("반환이 늦어질 수");
    expect(answer({ group: "tenant" }, "money").need).toBe("lease");
  });
});

describe("위험 신호", () => {
  it("세입자: 깡통전세 비율·보증보험 한도·시세 하락", () => {
    const flags = riskFlags(base({ lease: { deposit: 46000, role: "tenant" }, saleValue: 50000, official: 30000, jeonse: { current: 40000, gap: -6000, level: "위험" } }));
    expect(flags.map((f) => f.level)).toEqual(["bad", "bad", "bad"]);
    expect(flags[0].text).toContain("92%");
    expect(flags.some((f) => f.text.includes("보증보험 한도(약 3.78억)"))).toBe(true);
  });

  it("전월세 거주인데 보증금이 없으면 입력 요청", () => {
    expect(answer({ group: "tenant" }, "risk").need).toBe("lease");
  });

  it("규제·거래 부족·미등기 신고가·공급", () => {
    const flags = riskFlags(base({ value: { current: 80000, basis: "x", samples12m: 2 }, flags: { permit: true, unregistered: 0.25, supply: 9 } }));
    expect(flags).toHaveLength(4);
    expect(flags[0].text).toContain("실거주만");
  });

  it("1년 10% 넘게 내렸으면 위험(20% 넘으면 나쁨)", () => {
    expect(riskFlags(base({ change1y: -0.12 }))[0].level).toBe("warn");
    expect(riskFlags(base({ change1y: -0.31 }))[0]).toMatchObject({ level: "bad" });
    expect(riskFlags(base({ change1y: -0.31 }))[0].text).toContain("31% 내렸어요");
  });

  it("신호가 없으면 '눈에 띄는 위험 없음'", () => {
    expect(answer({}, "risk").tone).toBe("good");
  });
});

describe("눈여겨볼 지표", () => {
  const months = (n: number, f: (i: number) => number): [string, number][] =>
    Array.from({ length: n }, (_, i) => [`20${String(20 + Math.floor(i / 12)).padStart(2, "0")}-${String((i % 12) + 1).padStart(2, "0")}-01`, f(i)]);

  it("지역 시계열 → 신호 재료", () => {
    const r = regionSignals({
      corp: months(24, (i) => (i < 12 ? 0.04 : 0.09)),
      "ind.real": months(24, (i) => (i === 5 ? 120 : 100)),
      idx: months(24, (i) => 100 + i),
      "ind.burden": months(24, (i) => i),
    });
    expect(r.corp).toBeCloseTo(0.09);
    expect(r.corpChange).toBeCloseTo(0.05);
    expect(r.realFromPeak).toBeCloseTo(100 / 120 - 1);
    expect(r.burdenPct).toBe(1);
    expect(r.burdenYears).toBe(2);
  });

  it("평소와 다른 것만, 차이가 큰 순으로", () => {
    const s = notableSignals({
      floors: { mine: { label: "저층", premium: -0.07, n: 30 }, low: -0.07, high: 0.03 },
      jeonseContracts: { newMedian: 56000, renewalMedian: 50000 },
      region: { name: "영통구", jgap: 0.02, rrr: null, corp: 0.03, corpChange: 0.01, unreg: 0.14, direct: 0.05, realFromPeak: -0.04, realPeak: null, nominal1y: null, real1y: null, burdenPct: 0.5, burdenYears: 3 },
    });
    // 이 집에만 해당하는 지표(전세 계약·층)가 지역 공통 지표보다 앞
    expect(s.map((x) => x.key)).toEqual(["jgap", "floor", "unreg"]);
    expect(s[0].value).toBe("+12.0%");
    expect(s[1]).toMatchObject({ value: "-7.0%", tone: "down", source: "실거래 층 정보" });
    expect(s[2].label).toBe("영통구 등기 안 된 신고가");
  });

  it("신규·갱신 전세는 각각 3건 이상일 때만", () => {
    expect(notableSignals({ jeonseContracts: { newMedian: 4000, renewalMedian: 6500, newN: 1, renewalN: 2 } })).toEqual([]);
    expect(notableSignals({ jeonseContracts: { newMedian: 4000, renewalMedian: 6500, newN: 3, renewalN: 4 } })[0].note).toContain("최근 6개월 7건");
  });

  it("단지 자료가 없으면 지역 신규·갱신 차이로, 아무것도 두드러지지 않으면 빈 목록", () => {
    const quiet = { name: null, jgap: 0.01, rrr: null, corp: null, corpChange: null, unreg: 0.02, direct: 0.03, realFromPeak: 0, realPeak: null, nominal1y: null, real1y: null, burdenPct: 0.5, burdenYears: 3 };
    expect(notableSignals({ region: quiet })).toEqual([]);
    expect(notableSignals({ region: { ...quiet, jgap: 0.09, rrr: 0.6 } })[0].note).toContain("60%");
  });
});

describe("내 자금 프로필 읽기", () => {
  it("형식이 틀리면 무시, LTV 기본 50%", () => {
    expect(readFinanceProfile({})).toBeNull();
    expect(readFinanceProfile({ finance: { cash: null, income: null } })).toBeNull();
    expect(readFinanceProfile({ finance: { cash: 30000, income: "x", ltv: 3 } })).toEqual({ cash: 30000, income: null, ltv: 0.5 });
  });
});

describe("시장 판정 신뢰도", () => {
  const xs: Insight[] = [
    { key: "rate", tone: "up", title: "금리 하락", detail: "" },
    { key: "volume", tone: "down", title: "거래 위축", detail: "" },
    { key: "real", tone: "neutral", title: "실질", detail: "" },
  ];
  const bt = {
    horizon: 6,
    months: 40,
    baseUp: 0.6,
    rules: [
      { id: "rate:up", key: "rate", tone: "up" as const, title: "", n: 10, avgForward: 0.02, hitRate: 0.8 },
      { id: "volume:down", key: "volume", tone: "down" as const, title: "", n: 10, avgForward: -0.01, hitRate: 0.5 },
    ],
  };

  it("켜진 신호의 적중률을 표본 가중 평균, 기준선은 방향별 무작정 찍기", () => {
    const r = signalRecord(xs, bt)!;
    expect(r.signals).toBe(2);
    expect(r.hitRate).toBeCloseTo(0.65);
    expect(r.base).toBeCloseTo((0.6 + 0.4) / 2);
    expect(signalRecord(xs, null)).toBeNull();
    // 채점 기간이 24개월 미만이면 내세우지 않는다
    expect(signalRecord(xs, { ...bt, months: 6 })).toBeNull();
  });

  it("요인 순서: 적중률 높은 방향 요인 먼저, 참고 요인은 뒤", () => {
    expect(rankInsights(xs, bt).map((x) => x.key)).toEqual(["rate", "volume", "real"]);
  });
});
