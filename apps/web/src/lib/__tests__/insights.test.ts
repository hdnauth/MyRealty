import { describe, expect, it } from "vitest";
import { backtestInsights, insightBalance, marketInsights, paymentChange, percentile, type Point } from "../insights";

/** 2020-01부터 월별 시계열 */
function monthly(values: number[]): Point[] {
  return values.map((v, i) => {
    const d = new Date(Date.UTC(2020, i, 1));
    return [d.toISOString().slice(0, 10), v];
  });
}
const flat = (n: number, v: number) => monthly(Array.from({ length: n }, () => v));

describe("insights 보조 함수", () => {
  it("금리 1%p 상승 시 30년 원리금 월 상환 약 12% 증가", () => {
    expect(paymentChange(4, 5)).toBeCloseTo(0.124, 3);
    expect(paymentChange(4, 4)).toBe(0);
  });
  it("분위", () => {
    expect(percentile(monthly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe(1);
    expect(percentile(monthly([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]))).toBeCloseTo(1 / 12);
    expect(percentile(monthly([1, 2]))).toBeNull();
  });
});

describe("marketInsights", () => {
  it("금리 하락·인하 기대·거래 선행·전세가율 상승을 상승 요인으로", () => {
    const xs = marketInsights({
      "ecos.mortgage_rate": monthly([4.5, 4.4, 4.3, 4.2, 4.1, 4.0, 3.9]),
      "ecos.base_rate": flat(7, 3.0),
      "ecos.bond_3y": flat(7, 2.6),
      vol: monthly([...Array(9).fill(100), 160, 170, 180]),
      idx: monthly([...Array(12).fill(100), 100.5]),
      jr: monthly([...Array(12).fill(0.5), 0.53]),
    });
    const keys = Object.fromEntries(xs.map((x) => [x.key, x]));
    expect(keys.rate.tone).toBe("up");
    expect(keys.rate.detail).toContain("4.50% → 3.90%");
    expect(keys.curve.tone).toBe("up");
    expect(keys.volume.title).toContain("선행");
    expect(keys.jeonse.tone).toBe("up");
    expect(insightBalance(xs).verdict).toBe("상승 요인이 우세");
  });

  it("부담 고점권·하락 거래 우세·입주 과다는 하락 요인", () => {
    const xs = marketInsights({
      "ind.burden": monthly(Array.from({ length: 36 }, (_, i) => 40 + i)),
      dr: flat(3, 0.6),
      "ind.supply": flat(1, 10),
    });
    expect(xs.map((x) => [x.key, x.tone])).toEqual([
      ["burden", "down"],
      ["breadth", "down"],
      ["supply", "down"],
    ]);
  });

  it("실질 가격 고점 대비 하락과 명목·실질 분해", () => {
    const real = monthly([100, 120, 130, 110, 100, 95, 96, 97, 98, 99, 100, 101, 102, 103]);
    const idx = monthly([100, 125, 140, 120, 112, 108, 110, 112, 114, 116, 118, 120, 122, 124]);
    const [x] = marketInsights({ "ind.real": real, idx });
    expect(x.key).toBe("real");
    expect(x.title).toContain("고점(2020년 3월)");
    expect(x.detail).toContain("실질");
  });

  it("심리·신용·수급·미분양·인허가 파이프라인", () => {
    const xs = marketInsights({
      "ecos.housing_csi": monthly([100, 104, 108, 115]),
      "ecos.household_mortgage": monthly([...Array(12).fill(100), 107]),
      "reb.supply_demand": flat(3, 80),
      "kosis.unsold_done": monthly([...Array(12).fill(10000), 13000]),
      // 5년 평균보다 최근 1년 인허가가 절반
      "kosis.permits": monthly([...Array(60).fill(4000), ...Array(12).fill(2000)]),
    });
    const t = Object.fromEntries(xs.map((x) => [x.key, x.tone]));
    expect(t).toEqual({ csi: "up", credit: "up", supply_demand: "down", unsold: "down", pipeline: "up" });
  });

  it("데이터가 없으면 빈 목록", () => {
    expect(marketInsights({})).toEqual([]);
  });
});

describe("backtestInsights", () => {
  it("과거 시점 데이터만으로 신호를 내고 6개월 뒤 결과로 채점", () => {
    // 금리가 내려간 뒤 가격이 오르는 합성 시장: 36개월 보합 → 금리 하락 12개월 → 가격 상승
    const n = 72;
    const rate = monthly(Array.from({ length: n }, (_, i) => (i < 36 ? 5 : i < 48 ? 5 - (i - 35) * 0.1 : 3.8)));
    const idx = monthly(Array.from({ length: n }, (_, i) => (i < 40 ? 100 : 100 + (i - 40) * 1.5)));
    const r = backtestInsights({ "ecos.mortgage_rate": rate, idx })!;
    const down = r.rules.find((x) => x.id === "rate:up")!;
    expect(down.n).toBeGreaterThan(5);
    expect(down.hitRate).toBeGreaterThan(0.8);
    expect(r.months).toBe(n - 24 - 6);
    expect(backtestInsights({ idx: idx.slice(0, 20) })).toBeNull();
  });
});
