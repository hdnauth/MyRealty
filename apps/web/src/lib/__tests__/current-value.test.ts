import { describe, expect, it } from "vitest";
import { currentValue } from "../property";

describe("현재 시세 한 가지 기준", () => {
  const base = { estimate: null, median6m: null, last_trade_price: null, purchase_price: null };

  it("추정 시세 → 6개월 중위 → 최근 거래 → 매입가 순", () => {
    expect(currentValue({ ...base, estimate: 90000, median6m: 80000, last_trade_price: 83000, purchase_price: 72000 })).toEqual({ value: 90000, source: "estimate" });
    expect(currentValue({ ...base, median6m: 76500.5, last_trade_price: 83000, purchase_price: 72000 })).toEqual({ value: 76501, source: "median6m" });
    expect(currentValue({ ...base, last_trade_price: 83000, purchase_price: 72000 })).toEqual({ value: 83000, source: "last" });
    expect(currentValue({ ...base, purchase_price: 72000 })).toEqual({ value: 72000, source: "purchase" });
  });

  it("근거가 없으면 비운다", () => {
    expect(currentValue(base)).toEqual({ value: null, source: null });
  });
});
