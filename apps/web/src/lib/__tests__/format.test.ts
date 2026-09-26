import { describe, expect, it } from "vitest";
import { formatManwon, formatPct, perPyeong } from "../format";
import { makePnu } from "../property";
import { buildKeywords } from "../keywords";

describe("formatManwon", () => {
  it("억/만 단위", () => {
    expect(formatManwon(275000)).toBe("27억 5,000만");
    expect(formatManwon(200000)).toBe("20억");
    expect(formatManwon(8000)).toBe("8,000만");
    expect(formatManwon(null)).toBe("-");
  });
  it("짧은 형식은 정수의 0을 지우지 않는다", () => {
    expect(formatManwon(200000, { short: true })).toBe("20억");
    expect(formatManwon(100000, { short: true })).toBe("10억");
    expect(formatManwon(275000, { short: true })).toBe("27.5억");
    expect(formatManwon(12500, { short: true })).toBe("1.25억");
    expect(formatManwon(9500, { short: true })).toBe("9,500만");
  });
});

describe("기타", () => {
  it("평당가", () => {
    expect(Math.round(perPyeong(200000, 84.8)!)).toBe(7797);
  });
  it("퍼센트", () => {
    expect(formatPct(0.096)).toBe("+9.6%");
    expect(formatPct(-0.02)).toBe("-2.0%");
  });
  it("PNU", () => {
    expect(makePnu("1171010100", false, 19, 0)).toBe("1171010100100190000");
    expect(makePnu("1171010100", true, 12, 3)).toBe("1171010100200120003");
    expect(makePnu("11710", false, 1, 0)).toBeNull();
  });
  it("키워드", () => {
    expect(buildKeywords({ type: "apt", buildingName: "잠실엘스", emdName: "잠실동", sggName: "서울특별시 송파구", extra: "GTX" })).toEqual([
      "잠실엘스",
      "잠실엘스 재건축",
      "잠실동 아파트",
      "송파구 부동산",
      "GTX",
    ]);
  });
});
