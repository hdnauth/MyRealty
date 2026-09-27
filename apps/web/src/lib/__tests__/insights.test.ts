import { describe, expect, it } from "vitest";
import { insightBalance, marketInsights, paymentChange, percentile, type Point } from "../insights";

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

  it("데이터가 없으면 빈 목록", () => {
    expect(marketInsights({})).toEqual([]);
  });
});
