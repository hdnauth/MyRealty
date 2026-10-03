import { describe, expect, it } from "vitest";
import { shortSido, zonePhase, zoneSource } from "../projects";

describe("projects", () => {
  it("단계 묶음", () => {
    expect([1, 3, 4, 5, 6, 7, 8, 9].map(zonePhase)).toEqual(["early", "early", "union", "approved", "approved", "building", "building", "done"]);
    expect(zonePhase(null)).toBeNull();
  });
  it("시도 줄임", () => {
    expect(shortSido("서울특별시")).toBe("서울");
    expect(shortSido("경기도")).toBe("경기");
    expect(shortSido("전남광주통합특별시")).toBe("전남광주");
    expect(shortSido("강원특별자치도")).toBe("강원");
    expect(shortSido("경상남도")).toBe("경남");
  });
  it("출처 이름", () => {
    expect(zoneSource("seoul").label).toContain("정보몽땅");
    expect(zoneSource("dgk15068530").label).toContain("공공데이터포털");
  });
});
