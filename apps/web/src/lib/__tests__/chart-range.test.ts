import { describe, expect, it } from "vitest";
import { defaultRange, periodLabel, rangeOptions, rangeSince, timeLabel } from "../chart-range";

const NOW = new Date("2026-10-03T00:00:00");

describe("chart range", () => {
  it("offers only ranges shorter than the data span, plus 전체", () => {
    expect(rangeOptions("2024-01-01", NOW)).toEqual(["1y", "all"]);
    expect(rangeOptions("2019-05-01", NOW)).toEqual(["1y", "3y", "5y", "all"]);
    expect(rangeOptions("2010-01-01", NOW)).toEqual(["1y", "3y", "5y", "10y", "all"]);
  });

  it("has no choices for short or empty data", () => {
    expect(rangeOptions("2026-02-01", NOW)).toEqual([]);
    expect(rangeOptions(null, NOW)).toEqual([]);
    expect(rangeOptions("not-a-date", NOW)).toEqual([]);
  });

  it("falls back to 전체 when the wanted range is not offered", () => {
    expect(defaultRange(["1y", "all"], "3y")).toBe("all");
    expect(defaultRange(["1y", "3y", "all"], "3y")).toBe("3y");
  });

  it("computes the start day", () => {
    expect(rangeSince("1y", NOW)).toBe("2025-10-03");
    expect(rangeSince("all", NOW)).toBeNull();
  });
});

describe("time labels", () => {
  const ts = (s: string) => new Date(`${s}T00:00:00`).getTime();

  it("marks year boundaries and keeps the year on every month label", () => {
    expect(timeLabel(ts("2025-01-01"))).toBe("{y|2025년}");
    expect(timeLabel(ts("2025-04-01"))).toBe("25년 4월");
    expect(timeLabel(ts("2025-04-15"))).toBe("4.15");
  });

  it("formats tooltip periods", () => {
    expect(periodLabel("2025-03-01")).toBe("2025년 3월");
    expect(periodLabel("2025-03-15", true)).toBe("2025년 3월 15일");
  });
});
