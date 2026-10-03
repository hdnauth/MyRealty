import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, TYPE_LAYERS } from "../map-filters";
import { DEFAULT_MAP_PREFS, filtersFor, layersFor, normalizeMapPrefs, parseMapPrefs, serializeMapPrefs, sortFor, zoneKindOf } from "../map-prefs";

describe("지도 설정 저장", () => {
  it("쿠키 문자열로 오가도 값이 같다(인코딩 여부와 무관)", () => {
    const p = {
      ...DEFAULT_MAP_PREFS,
      type: "land",
      kindByType: { officetel: "wolse" as const, apt: "jeonse" as const },
      months: 36,
      filtersByType: { land: { ...EMPTY_FILTERS, priceMax: 100_000, cats: ["site", "farm"], noShare: true }, commercial: { ...EMPTY_FILTERS, floor: "ground" as const } },
      sortByType: { land: "share_asc" as const, officetel: "yield_desc" as const },
      labelMode: "total" as const,
      layersByType: { land: ["cadastral", "zoning"], apt: [] },
      baseMap: "satellite" as const,
    };
    const raw = serializeMapPrefs(p);
    expect(raw).not.toContain("priceMin"); // 빈 조건은 저장하지 않는다
    expect(raw).not.toContain("zones");
    expect(parseMapPrefs(raw)).toEqual(p);
    expect(parseMapPrefs(encodeURIComponent(raw))).toEqual(p);
  });

  it("레이어는 유형별로 기억하고, 모두 끈 빈 목록은 추천으로 되돌리지 않는다", () => {
    const p = normalizeMapPrefs({ layersByType: { apt: [], land: ["cadastral", "nope"] } });
    expect(layersFor(p, "apt")).toEqual([]);
    expect(layersFor(p, "land")).toEqual(["cadastral"]);
    // 처음 보는 유형은 그 유형의 추천 레이어
    expect(layersFor(p, "commercial")).toEqual(TYPE_LAYERS.commercial);
  });

  it("예전 형식(유형 구분 없는 레이어 목록)은 마지막에 보던 유형으로 옮긴다", () => {
    const p = normalizeMapPrefs({ type: "officetel", layers: ["subway", "school"] });
    expect(p.layersByType).toEqual({ officetel: ["subway", "school"] });
  });

  it("모르는 값은 버리고 기본값으로", () => {
    const p = normalizeMapPrefs({ type: "castle", kind: "lease", months: 7, sort: "zzz", labelMode: "x", layers: ["subway", "nope", "subway"], baseMap: "space", filters: { priceMax: -5, areaMin: 80, cats: ["site", "x"], bldg: "?" } });
    // 예전 형식(유형 구분 없는 조건·레이어)은 마지막 유형(모르면 아파트)으로 옮긴다
    expect(p).toEqual({ ...DEFAULT_MAP_PREFS, layersByType: { apt: ["subway"] }, filtersByType: { apt: { ...EMPTY_FILTERS, areaMin: 80, cats: ["site"] } } });
  });

  it("거래 종류는 유형별로, 예전 한 값은 그 유형으로 옮긴다", () => {
    expect(normalizeMapPrefs({ type: "officetel", kind: "wolse" }).kindByType).toEqual({ officetel: "wolse" });
    expect(normalizeMapPrefs({ kindByType: { apt: "jeonse", land: "rent" } }).kindByType).toEqual({ apt: "jeonse" });
  });

  it("조건·정렬은 유형별로 따로", () => {
    const p = normalizeMapPrefs({ filtersByType: { land: { noShare: true } }, sortByType: { officetel: "yield_desc", land: "bad" } });
    expect(filtersFor(p, "land").noShare).toBe(true);
    expect(filtersFor(p, "commercial")).toEqual(EMPTY_FILTERS);
    expect(sortFor(p, "officetel")).toBe("yield_desc");
    expect(sortFor(p, "land")).toBe("n");
  });

  it("예전 '개발사업' 레이어는 정비구역·철도/도로 둘로 나눈다", () => {
    expect(normalizeMapPrefs({ layersByType: { apt: ["projects", "subway"] } }).layersByType.apt).toEqual(["zones", "infra", "subway"]);
  });

  it("정비구역 보기: 모르는 단계·종류는 버리고, 없으면 전부", () => {
    expect(normalizeMapPrefs({ zoneView: { phases: ["union", "x"], kinds: ["rebuild"] } }).zoneView).toEqual({ phases: ["union"], kinds: ["rebuild"] });
    expect(normalizeMapPrefs({}).zoneView).toEqual({ phases: null, kinds: null });
  });

  it("정비사업 종류 묶기", () => {
    expect(zoneKindOf("재건축")).toBe("rebuild");
    expect(zoneKindOf("소규모재건축")).toBe("small");
    expect(zoneKindOf("도시정비형 재개발")).toBe("redev");
    expect(zoneKindOf("가로주택정비")).toBe("small");
    expect(zoneKindOf(null)).toBe("small");
  });

  it("없거나 깨진 쿠키는 null", () => {
    expect(parseMapPrefs(undefined)).toBeNull();
    expect(parseMapPrefs("")).toBeNull();
    expect(parseMapPrefs("%7Bbroken")).toBeNull();
  });
});
