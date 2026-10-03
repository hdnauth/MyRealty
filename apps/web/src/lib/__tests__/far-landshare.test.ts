import { describe, expect, it } from "vitest";
import { farCap } from "../far";
import { aggregateLive } from "../live-aggregate";
import { activeFilterCount, applicableFilters, EMPTY_FILTERS, filtersFromQuery, filtersToQuery, type MapPoint, presetsFor, sortPoints, sortsFor } from "../map-filters";
import type { LiveTrade } from "../rtms-parse";

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

describe("용적률 상한", () => {
  it("서울은 서울시 조례, 그 밖은 법정 상한", () => {
    expect(farCap(["제2종일반주거지역"], "11680")).toEqual({ zone: "제2종일반주거지역", cap: 200, basis: "seoul" });
    expect(farCap(["도시지역", "제3종일반주거지역"], "41115")).toEqual({ zone: "제3종일반주거지역", cap: 300, basis: "law" });
    expect(farCap(["자연녹지지역"], "41115")).toBeNull();
    expect(farCap(null, null)).toBeNull();
  });
});

describe("용적률·대지지분 조건", () => {
  it("쿼리로 오가고, 맞는 유형에서만 센다", () => {
    const f = { ...EMPTY_FILTERS, farMax: 200, lsMin: 33 };
    const q = filtersToQuery(f);
    expect(q).toContain("far_max=200");
    expect(q).toContain("ls_min=33");
    expect(filtersFromQuery(new URLSearchParams(q))).toEqual(f);
    expect(activeFilterCount(f, "apt")).toBe(2);
    // 빌라는 대지지분만, 오피스텔은 둘 다 해당 없음
    expect(applicableFilters(f, "rowhouse")).toMatchObject({ farMax: null, lsMin: 33 });
    expect(activeFilterCount(f, "officetel")).toBe(0);
  });

  it("정렬: 용적률 낮은 순 · 대지지분 큰 순 · 대지지분 평당가 낮은 순(값 없는 곳은 뒤로)", () => {
    const ps = [pt("a", { far: 250, land_share: 40, land_share_ppy: 4000 }), pt("b", { far: 180, land_share: 60, land_share_ppy: 3000 }), pt("c", {})];
    expect(sortPoints(ps, "far_asc").map((p) => p.key)).toEqual(["b", "a", "c"]);
    expect(sortPoints(ps, "land_desc").map((p) => p.key)).toEqual(["b", "a", "c"]);
    expect(sortPoints(ps, "landppy_asc").map((p) => p.key)).toEqual(["b", "a", "c"]);
    expect(sortsFor("apt").map((s) => s.key)).toContain("far_asc");
    expect(sortsFor("rowhouse").map((s) => s.key)).not.toContain("far_asc");
    expect(sortsFor("rowhouse", "jeonse").map((s) => s.key)).not.toContain("landppy_asc");
  });

  it("추천 묶음", () => {
    const biz = presetsFor("apt").find((p) => p.key === "rebuild-biz")!;
    expect(biz.filters(2026)).toEqual({ yearMax: 1996, farMax: 200 });
    expect(presetsFor("rowhouse").find((p) => p.key === "land10")!.filters(2026)).toEqual({ lsMin: 33 });
  });
});

describe("수집 전 지역 미리보기 집계", () => {
  const tr = (o: Partial<LiveTrade>): LiveTrade => ({
    kind: "sale",
    date: "2026-09-01",
    price: 50_000,
    rent: null,
    area: 84.9,
    floor: 5,
    umd: "우만동",
    jibun: "100",
    name: "우만주공",
    jimok: null,
    buildYear: 1989,
    canceled: false,
    ...o,
  });

  it("중위·건수·최근 거래", () => {
    const p = aggregateLive("Lx", "complex", "우만주공", 127, 37, [
      tr({ price: 40_000, date: "2026-08-01" }),
      tr({ price: 60_000, date: "2026-09-20", buildYear: 1987 }),
      tr({ price: 50_000, date: "2026-07-10", area: null }),
    ]);
    expect(p).toMatchObject({ n: 3, median_price: 50_000, last_date: "2026-09-20", build_year: 1987, live: true, complex_id: null });
    expect(p.median_ppy).toBeCloseTo(50_000 / (84.9 / 3.305785), 0);
    expect(p.recent!.map((r) => r.date)).toEqual(["2026-09-20", "2026-08-01", "2026-07-10"]);
  });
});
