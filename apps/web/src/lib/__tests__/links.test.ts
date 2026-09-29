import { describe, expect, it } from "vitest";
import { complexHref, mapAtHref, registerComplexHref } from "../links";

describe("링크 규칙", () => {
  it("내 관심 부동산 단지는 그 상세로, 아니면 단지 상세로", () => {
    const mine = { 123: "item-uuid" };
    expect(complexHref(123, mine)).toBe("/items/item-uuid");
    expect(complexHref(123, mine, { tab: "price" })).toBe("/items/item-uuid?tab=price");
    expect(complexHref(75, mine)).toBe("/complexes/75");
    expect(complexHref(75, mine, { area: 125 })).toBe("/complexes/75?area=125.0");
    expect(complexHref(75, null)).toBe("/complexes/75");
  });
  it("지도 위치·등록 링크", () => {
    expect(mapAtHref(127.123456, 37.5, "land")).toBe("/map?at=127.12346,37.50000&type=land");
    expect(registerComplexHref(75)).toBe("/items/new?complex=75");
  });
});
