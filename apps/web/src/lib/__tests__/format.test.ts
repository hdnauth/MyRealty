import { describe, expect, it } from "vitest";
import { formatArea, formatManwon, formatPct, parseManwon, perPyeong } from "../format";
import { makePnu } from "../property";
import { buildKeywords } from "../keywords";

describe("parseManwon", () => {
  it("억·천·만·원 표기를 만원으로", () => {
    expect(parseManwon("15억")).toBe(150000);
    expect(parseManwon("15억 3,000")).toBe(153000);
    expect(parseManwon("15억3천만")).toBe(153000);
    expect(parseManwon("3.5억")).toBe(35000);
    expect(parseManwon("8,500만")).toBe(8500);
    expect(parseManwon("5천만원")).toBe(5000);
    expect(parseManwon("150000")).toBe(150000);
    expect(parseManwon("1,500,000,000원")).toBe(150000);
  });
  it("읽을 수 없으면 null", () => {
    expect(parseManwon("")).toBeNull();
    expect(parseManwon("abc")).toBeNull();
    expect(parseManwon("억")).toBeNull();
  });
});

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

import { jeonseRisk, monthlyPayment, scenario } from "../finance";

describe("finance", () => {
  it("원리금균등", () => {
    expect(Math.round(monthlyPayment(30000, 4, 30) * 10) / 10).toBe(143.2);
    expect(monthlyPayment(12000, 0, 30)).toBe(12000 / 360);
  });
  it("시나리오 DSR", () => {
    const s = scenario({ price: 100000, ltv: 0.5, rate: 4, years: 30, incomeAnnual: 10000 });
    expect(s.loan).toBe(50000);
    expect(s.dsr).toBeCloseTo((monthlyPayment(50000, 4, 30) * 12) / 10000, 6);
  });
  it("전세 위험", () => {
    expect(jeonseRisk({ deposit: 20000, marketPrice: 30000, officialPrice: 20000 }).level).toBe("안전");
    expect(jeonseRisk({ deposit: 26000, marketPrice: 30000, officialPrice: 22000 }).level).toBe("주의");
    // 공시가 126% 초과 → 위험
    expect(jeonseRisk({ deposit: 26000, marketPrice: 40000, officialPrice: 20000 }).level).toBe("위험");
    expect(jeonseRisk({ deposit: 1, marketPrice: null, officialPrice: null }).level).toBe("판단불가");
    expect(jeonseRisk({ deposit: 0, marketPrice: 30000, officialPrice: 20000 }).level).toBe("판단불가");
  });
});

import { comprehensiveTax, holdingTax, propertyTax } from "../tax";

describe("보유세 개략", () => {
  it("재산세 누진(표준세율)", () => {
    // 공시 5억, 일반: 과표 3억 → 6만 + 13.5만 + 37.5만 = 57만 (본세)
    expect(Math.round(propertyTax(50000, false).main * 10) / 10).toBe(57);
  });
  it("1주택 특례세율·비율", () => {
    const t = propertyTax(50000, true); // 과표 5억×44%=2.2억 → 3+9+14=26만
    expect(Math.round(t.main)).toBe(26);
  });
  it("종부세 공제 이하면 0", () => {
    expect(comprehensiveTax(110000, true).total).toBe(0);
    expect(comprehensiveTax(150000, true).main).toBeCloseTo(18000 * 0.005, 6);
  });
  it("합계", () => {
    const h = holdingTax([150000], true);
    expect(h.total).toBeGreaterThan(h.property);
  });
});

import { safeHref } from "../format";

describe("safeHref", () => {
  it("http(s)·내부 경로만 허용", () => {
    expect(safeHref("https://a.com/x")).toBe("https://a.com/x");
    expect(safeHref("/items/1")).toBe("/items/1");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.com")).toBeNull();
  });
});

describe("formatArea 큰 토지", () => {
  it("1,000㎡ 이상은 소수점 없이 천 단위 구분", () => {
    expect(formatArea(123106)).toBe("123,106㎡ (37,240평)");
    expect(formatArea(84.93)).toBe("84.9㎡ (25.7평)");
  });
});
