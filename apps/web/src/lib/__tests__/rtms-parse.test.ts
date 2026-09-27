import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeLive, parseRtmsXml, RTMS_SERVICES, recentMonths } from "../rtms-parse";

const fixture = (name: string) => readFileSync(path.resolve(__dirname, "../../../../../services/etl/tests/fixtures", name), "utf8");

describe("실거래 API 미리보기 해석", () => {
  it("매매 XML → 거래(해제 표시·금액 쉼표·공백)", () => {
    const { items, total } = parseRtmsXml(fixture("rtms_apt_trade.xml"));
    expect(items.length).toBe(total);
    const rows = items.map((it) => normalizeLive(it, RTMS_SERVICES.apt[0])).filter((r) => r !== null);
    expect(rows[0]).toMatchObject({ kind: "sale", date: "2026-08-12", price: 275000, area: 84.8, floor: 15, umd: "잠실동", jibun: "19", name: "잠실엘스", canceled: false });
    expect(rows[1].canceled).toBe(true);
  });

  it("전월세 XML → 전세/월세 구분", () => {
    const { items } = parseRtmsXml(fixture("rtms_apt_rent.xml"));
    const rows = items.map((it) => normalizeLive(it, RTMS_SERVICES.apt[1])).filter((r) => r !== null);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.kind === "jeonse" ? r.rent === 0 : (r.rent ?? 0) > 0).toBe(true);
  });

  it("오류 응답은 예외", () => {
    expect(() => parseRtmsXml(fixture("rtms_error.xml"))).toThrow(/실거래 API 오류/);
  });

  it("최근 달 목록", () => {
    expect(recentMonths(3, new Date(2026, 0, 15))).toEqual(["202601", "202512", "202511"]);
  });
});
