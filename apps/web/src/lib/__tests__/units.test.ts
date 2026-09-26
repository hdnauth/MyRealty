import { describe, expect, it } from "vitest";
import {
  aggregateUnits,
  areaTypeLabel,
  clusterAreas,
  dongHo,
  floorFromHo,
  matchAreaType,
  parseDongList,
  typeFromJimok,
  typeFromPurpose,
} from "../units";

describe("clusterAreas", () => {
  it("비슷한 전용면적을 한 평형으로 묶고 대표값은 가장 흔한 값", () => {
    const r = clusterAreas([
      { area: 84.97, count: 10, units: 10 },
      { area: 84.99, count: 30, units: 30, supply: 112.4 },
      { area: 59.96, count: 5, trades: 5, medianPrice: 98000 },
      { area: 119.93, count: 2, units: 2 },
    ]);
    expect(r.map((t) => t.area)).toEqual([59.96, 84.99, 119.93]);
    expect(r[1]).toMatchObject({ units: 40, supply: 112.4, trades: 0 });
    expect(r[0]).toMatchObject({ trades: 5, medianPrice: 98000, units: null });
  });

  it("평형 찾기와 표기", () => {
    const types = clusterAreas([{ area: 84.99, count: 1, supply: 112.4 }, { area: 59.9, count: 1 }]);
    expect(matchAreaType(types, 84.8)?.area).toBe(84.99);
    expect(matchAreaType(types, 70)).toBeNull();
    expect(areaTypeLabel(types[1])).toBe("34평형");
    expect(areaTypeLabel(types[0])).toBe("전용 18.1평");
  });
});

describe("동·호", () => {
  it("호수에서 층을 추정", () => {
    expect(floorFromHo("1502")).toBe(15);
    expect(floorFromHo("302호")).toBe(3);
    expect(floorFromHo("B102")).toBeNull();
    expect(floorFromHo("12")).toBeNull();
  });
  it("동/호 문자열", () => {
    expect(dongHo("101", "1502")).toBe("101동 1502호");
    expect(dongHo("제101동", "")).toBe("101동");
    expect(dongHo("", "1502호")).toBe("1502호");
  });
  it("상세건물명에서 주거동만 숫자 순으로", () => {
    expect(parseDongList("102동,101동,관리동,상가동,경비실,103동")).toEqual(["101동", "102동", "103동"]);
    expect(parseDongList("")).toEqual([]);
  });
});

describe("유형 판별", () => {
  it("건축물대장 용도", () => {
    expect(typeFromPurpose("공동주택", "아파트")).toBe("apt");
    expect(typeFromPurpose("업무시설", "오피스텔")).toBe("officetel");
    expect(typeFromPurpose("공동주택", "다세대주택")).toBe("rowhouse");
    expect(typeFromPurpose("단독주택", "다가구주택")).toBe("house");
    expect(typeFromPurpose("제2종근린생활시설", "사무소")).toBe("commercial");
    expect(typeFromPurpose(null, null)).toBeNull();
  });
  it("지목", () => {
    expect(typeFromJimok("임야", false)).toBe("forest");
    expect(typeFromJimok("대", true)).toBe("forest");
    expect(typeFromJimok("전", false)).toBe("land");
  });
});

describe("aggregateUnits", () => {
  it("호별 전용 합계, 주거공용만 더한 공급면적, 층", () => {
    const rows = [
      { dongNm: "101동", hoNm: "1502호", flrNo: "15", flrGbCdNm: "지상", exposPubuseGbCd: "1", mainPurpsCdNm: "공동주택", etcPurps: "아파트", area: "84.99" },
      { dongNm: "101동", hoNm: "1502호", flrNo: "15", flrGbCdNm: "지상", exposPubuseGbCd: "2", mainPurpsCdNm: "공동주택", etcPurps: "계단실", area: "27.4" },
      { dongNm: "101동", hoNm: "1502호", flrNo: "1", flrGbCdNm: "지하", exposPubuseGbCd: "2", mainPurpsCdNm: "공동주택", etcPurps: "주차장", area: "40" },
      { dongNm: "101동", hoNm: "102호", flrNo: "1", flrGbCdNm: "지상", exposPubuseGbCdNm: "전유", mainPurpsCdNm: "공동주택", etcPurps: "아파트", area: "59.9" },
    ];
    const u = aggregateUnits(rows);
    expect(u).toHaveLength(2);
    expect(u[0]).toMatchObject({ dong: "101동", ho: "1502호", floor: 15, area: 84.99, supply: 112.39 });
    expect(u[1]).toMatchObject({ ho: "102호", floor: 1, area: 59.9, supply: null });
  });
});
