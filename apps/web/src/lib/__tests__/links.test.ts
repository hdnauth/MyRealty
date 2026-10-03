import { describe, expect, it } from "vitest";
import { complexHref, mapAtHref, registerComplexHref } from "../links";
import { legacyItemTabHref } from "../item-tabs";

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

describe("예전 상세 탭 주소", () => {
  const id = "7dcf60c1-fb62-4187-baed-e230ee24d965";
  it("합쳐진 탭과 섹션으로 보낸다", () => {
    expect(legacyItemTabHref(`/items/${id}`, new URLSearchParams("tab=nearby&all=1"))).toBe(`/items/${id}?nall=1&tab=price#compare`);
    expect(legacyItemTabHref(`/items/${id}`, new URLSearchParams("tab=analysis"))).toBe(`/items/${id}?tab=overview#ai`);
    expect(legacyItemTabHref(`/items/${id}`, new URLSearchParams("tab=talk&area=84.9"))).toBe(`/items/${id}?area=84.9&tab=news#talk`);
  });
  it("새 탭·다른 경로는 그대로", () => {
    expect(legacyItemTabHref(`/items/${id}`, new URLSearchParams("tab=price"))).toBeNull();
    expect(legacyItemTabHref(`/items/${id}/edit`, new URLSearchParams("tab=nearby"))).toBeNull();
    expect(legacyItemTabHref("/complexes/2", new URLSearchParams("tab=nearby"))).toBeNull();
  });
});
