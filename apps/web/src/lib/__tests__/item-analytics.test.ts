import { describe, expect, it } from "vitest";
import { floorBandOf, floorPremiums, jeonseCheck, rateSensitivity } from "../item-analytics";

const NOW = new Date("2026-09-01");
const day = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);

describe("floorPremiums", () => {
  it("시점 효과를 빼고 저층 할인·고층 할증을 잡는다", () => {
    const pts = [];
    // 3년 동안 가격이 오르는 단지: 저층(2층)은 0.9배, 중층(10층) 1.0배, 고층(18층) 1.05배
    for (let i = 0; i < 36; i++) {
      const base = 100000 * (1 + i * 0.01);
      const d = day((36 - i) * 30);
      pts.push({ deal_kind: "sale", deal_date: d, price: base * 0.9, floor: 2, is_canceled: false });
      pts.push({ deal_kind: "sale", deal_date: d, price: base, floor: 10, is_canceled: false });
      pts.push({ deal_kind: "sale", deal_date: d, price: base * 1.05, floor: 18, is_canceled: false });
    }
    const r = floorPremiums(pts, { now: NOW })!;
    expect(r.maxFloor).toBe(18);
    const [low, mid, high] = r.bands;
    expect(low.range).toBe("1~5층");
    expect(low.premium!).toBeCloseTo(-0.1, 2);
    expect(mid.premium!).toBeCloseTo(0, 2);
    expect(high.premium!).toBeCloseTo(0.05, 2);
    expect(floorBandOf(12, r.bands)?.key).toBe("mid");
    expect(floorBandOf(17, r.bands)?.key).toBe("high");
  });
  it("표본이 적으면 null", () => {
    expect(floorPremiums([{ deal_kind: "sale", deal_date: day(10), price: 1, floor: 3, is_canceled: false }], { now: NOW })).toBeNull();
  });
});

describe("rateSensitivity", () => {
  it("금리 ±1%p 월 상환 변화", () => {
    const rows = rateSensitivity(50000, 4, 30);
    expect(rows.map((r) => r.delta)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(rows[2].diff).toBe(0);
    expect(rows[4].diff).toBeGreaterThan(0);
    expect(rows[0].diff).toBeLessThan(0);
    // 5억, 4% → 5%: 월 약 29.6만원 증가
    expect(rows[4].diff).toBeCloseTo(29.7, 0);
  });
  it("금리가 0 이하가 되는 구간은 뺀다", () => {
    expect(rateSensitivity(10000, 0.8, 30).map((r) => r.delta)).toEqual([-0.5, 0, 0.5, 1]);
  });
});

describe("jeonseCheck", () => {
  const pts = [
    ...[700, 720, 710].map((d) => ({ deal_kind: "jeonse", deal_date: day(d), price: 60000, floor: 5, is_canceled: false })),
    ...[30, 60, 90].map((d) => ({ deal_kind: "jeonse", deal_date: day(d), price: 52000, floor: 5, is_canceled: false })),
  ];
  it("2년 전보다 전세 시세가 내려 보증금보다 낮으면 역전세", () => {
    const r = jeonseCheck({ deposit: 60000, role: "landlord", points: pts, now: NOW });
    expect(r.current).toBe(52000);
    expect(r.twoYearsAgo).toBe(60000);
    expect(r.trend!).toBeCloseTo(-0.133, 2);
    expect(r.gap).toBe(-8000);
    expect(r.level).toBe("위험");
  });
  it("보증금이 없으면 판단불가", () => {
    expect(jeonseCheck({ deposit: null, role: null, points: pts, now: NOW }).level).toBe("판단불가");
  });
});
