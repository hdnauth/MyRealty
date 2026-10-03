import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applicableFilters,
  EMPTY_FILTERS,
  filtersFromQuery,
  filtersToQuery,
  kindFor,
  type MapPoint,
  presetsFor,
  sameFilters,
  sortPoints,
  sortsFor,
} from "../map-filters";
import { regionInsights, type RegionSignals } from "../region-market";

describe("유형별 지도 조건", () => {
  it("목록·참거짓 조건도 쿼리로 오간다", () => {
    const f = { ...EMPTY_FILTERS, cats: ["site", "farm"], zones: ["mgmt"], noShare: true, bldg: "집합" as const, floor: "ground" as const, yieldMin: 0.05, rentMax: 60 };
    const q = filtersToQuery(f);
    expect(q).toContain("cats=site%2Cfarm");
    expect(filtersFromQuery(new URLSearchParams(q))).toEqual(f);
    // 모르는 값은 버린다
    expect(filtersFromQuery(new URLSearchParams("cats=site,evil&bldg=x&floor=roof")).cats).toEqual(["site"]);
  });

  it("그 유형·거래 종류에 없는 조건은 세지도 보내지도 않는다", () => {
    const f = { ...EMPTY_FILTERS, cats: ["site"], noShare: true, yieldMin: 0.05, rentMax: 50, yearMin: 2015 };
    expect(activeFilterCount(f, "land")).toBe(2); // 지목·지분
    expect(activeFilterCount(f, "officetel")).toBe(2); // 수익률·준공 (월세 상한은 월세 보기에서만)
    expect(activeFilterCount(f, "officetel", "wolse")).toBe(3);
    expect(activeFilterCount(f, "house")).toBe(1); // 준공만 — '대지'는 토지 지목이라 단독에서는 세지 않는다
    expect(activeFilterCount({ ...f, cats: ["site", "multi"] }, "house")).toBe(2);
    expect(applicableFilters({ ...f, cats: ["site", "multi"] }, "house").cats).toEqual(["multi"]);
    const a = applicableFilters(f, "land");
    expect(a.yieldMin).toBeNull();
    expect(a.yearMin).toBeNull(); // 토지는 준공 연도가 없다
    expect(a.cats).toEqual(["site"]);
  });

  it("토지·상가는 매매로만 본다", () => {
    expect(kindFor("land", "jeonse")).toBe("sale");
    expect(kindFor("commercial", "wolse")).toBe("sale");
    expect(kindFor("officetel", "wolse")).toBe("wolse");
  });

  it("정렬·추천 묶음은 유형마다 다르다", () => {
    expect(sortsFor("land").map((s) => s.key)).toContain("share_asc");
    expect(sortsFor("land").map((s) => s.key)).not.toContain("yield_desc");
    expect(sortsFor("officetel").map((s) => s.key)).toContain("yield_desc");
    expect(sortsFor("officetel").map((s) => s.key)).not.toContain("rent_asc");
    expect(sortsFor("officetel", "wolse").map((s) => s.key)).toContain("rent_asc");
    for (const t of ["apt", "officetel", "rowhouse", "house", "land", "commercial"]) expect(presetsFor(t).length).toBeGreaterThanOrEqual(3);
    expect(presetsFor("land").map((p) => p.key)).toContain("no-share");
  });

  it("목록 조건 비교는 순서와 무관", () => {
    expect(sameFilters({ ...EMPTY_FILTERS, cats: ["a", "b"] }, { ...EMPTY_FILTERS, cats: ["b", "a"] })).toBe(true);
    expect(sameFilters({ ...EMPTY_FILTERS, noShare: true }, EMPTY_FILTERS)).toBe(false);
  });

  it("수익률 정렬은 값이 없는 곳을 뒤로, 단위가격은 대지 평당가를 먼저 본다", () => {
    const pt = (key: string, o: Partial<MapPoint>): MapPoint => ({
      key, kind: "complex", complex_id: 1, name: key, lng: 0, lat: 0, n: 1, median_price: 1, median_ppy: 100, last_date: "", build_year: null, households: null, jeonse_ratio: null, change_1y: null, loc_score: null, ...o,
    });
    expect(sortPoints([pt("a", {}), pt("b", { rent_yield: 0.04 }), pt("c", { rent_yield: 0.06 })], "yield_desc").map((p) => p.key)).toEqual(["c", "b", "a"]);
    expect(sortPoints([pt("a", { median_ppy: 100, land_ppy: 900 }), pt("b", { median_ppy: 500 })], "ppy_asc").map((p) => p.key)).toEqual(["b", "a"]);
  });
});

describe("동네 '눈여겨볼 점'", () => {
  const base: RegionSignals = {
    saleN: 0, shareN: 0, sharePerM2: null, noSharePerM2: null, directN: 0, corpN: 0, corpKnown: 0, vol12: 0, volPrev: 0, roadN: 0, farmN: 0,
    landPerM2_12: null, agedKnown: 0, agedN: 0, jeonsePerM2: null, wolseDepPerM2: null, rentPerM2: null, groundPerM2: null, groundN: 0, upperPerM2: null, upperN: 0,
  };
  const titles = (type: "land" | "house" | "commercial", s: Partial<RegionSignals>) => regionInsights({ type, signals: { ...base, ...s } }, "m2").map((x) => `${x.tone}:${x.title}`);

  it("토지 지분거래가 많으면 경고하고 ㎡당 배율을 붙인다", () => {
    const t = titles("land", { saleN: 100, shareN: 40, sharePerM2: 30, noSharePerM2: 10 });
    expect(t[0]).toBe("warn:지분거래 40% · ㎡당 일반 거래의 3.0배");
  });
  it("표본이 적으면 말하지 않는다", () => {
    expect(titles("land", { saleN: 3, shareN: 3 })).toEqual([]);
  });
  it("상가 1층 프리미엄과 임대료 비공개 안내", () => {
    const t = titles("commercial", { groundPerM2: 765, groundN: 10, upperPerM2: 317, upperN: 20 });
    expect(t).toContain("info:1층 ㎡당이 상층의 2.4배");
    expect(t).toContain("info:임대료는 공개되지 않아요");
  });
  it("단독 전월세 전환율", () => {
    const t = titles("house", { jeonsePerM2: 300, wolseDepPerM2: 50, rentPerM2: 1 });
    expect(t).toContain("info:전월세 전환율 약 4.8%");
  });
  it("거래량 급변", () => {
    expect(titles("house", { vol12: 20, volPrev: 10 })).toContain("good:매매 거래량 1년 새 +100%");
  });
});
