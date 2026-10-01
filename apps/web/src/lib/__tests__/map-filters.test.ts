import { describe, expect, it } from "vitest";
import { activeFilterCount, EMPTY_FILTERS, filtersFromQuery, filtersToQuery, type MapPoint, normalizeFilters, sortPoints } from "../map-filters";

const pt = (key: string, o: Partial<MapPoint>): MapPoint => ({
  key,
  kind: "complex",
  complex_id: 1,
  name: key,
  lng: 127,
  lat: 37,
  n: 1,
  median_price: 50_000,
  median_ppy: 3000,
  last_date: "2026-09-01",
  build_year: null,
  households: null,
  jeonse_ratio: null,
  change_1y: null,
  loc_score: null,
  ...o,
});

describe("지도 조건 검색 필터", () => {
  it("쿼리 문자열로 오가도 값이 같다", () => {
    const f = { ...EMPTY_FILTERS, priceMax: 100_000, areaMin: 80, areaMax: 90, jrMin: 0.7, chgMin: -0.05, yearMin: 2016 };
    const q = filtersToQuery(f);
    expect(q).toContain("price_max=100000");
    expect(q).not.toContain("price_min");
    expect(filtersFromQuery(new URLSearchParams(q))).toEqual(f);
  });
  it("범위를 벗어나거나 숫자가 아닌 값은 버린다", () => {
    const f = filtersFromQuery(new URLSearchParams("jr_min=abc&loc_min=500&year_min=2010&price_max="));
    expect(f).toEqual({ ...EMPTY_FILTERS, yearMin: 2010 });
    expect(normalizeFilters({ jrMin: "0.7", locMin: 70, x: 1 })).toEqual({ ...EMPTY_FILTERS, locMin: 70 });
    expect(normalizeFilters(null)).toEqual(EMPTY_FILTERS);
  });
  it("단지 전용 필터는 토지·단독 유형에서 세지 않는다", () => {
    const f = { ...EMPTY_FILTERS, yearMin: 2015, priceMax: 50_000 };
    expect(activeFilterCount(f, "apt")).toBe(2);
    expect(activeFilterCount(f, "land")).toBe(1);
  });
  it("정렬은 값이 없는 곳을 뒤로 보낸다", () => {
    const ps = [pt("a", { jeonse_ratio: null, n: 9 }), pt("b", { jeonse_ratio: 0.6 }), pt("c", { jeonse_ratio: 0.8 })];
    expect(sortPoints(ps, "jr_desc").map((p) => p.key)).toEqual(["c", "b", "a"]);
    const prices = [pt("x", { median_price: 90_000 }), pt("y", { median_price: 30_000 })];
    expect(sortPoints(prices, "price_asc").map((p) => p.key)).toEqual(["y", "x"]);
    expect(sortPoints(prices, "price_desc").map((p) => p.key)).toEqual(["x", "y"]);
  });
});
