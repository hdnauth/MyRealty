import { describe, expect, it } from "vitest";
import { evaluate, ExprError, parse, seriesCodes, toPoints } from "../expr";

const data: Record<string, [string, number][]> = {
  "idx.11710": [["2025-01-01", 100], ["2025-02-01", 102], ["2025-03-01", 104], ["2026-01-01", 110], ["2026-02-01", 112]],
  "ecos.base_rate": [["2025-01-01", 3], ["2025-02-01", 2.75], ["2025-03-01", 2.75], ["2026-01-01", 2.5], ["2026-02-01", 2.5]],
};

describe("expr", () => {
  it("우선순위와 코드 인식", () => {
    const n = parse("idx.11710 / ecos.base_rate * 2 - 1");
    expect([...seriesCodes(n)].sort()).toEqual(["ecos.base_rate", "idx.11710"]);
    const pts = toPoints(evaluate(n, data));
    expect(pts[0]).toEqual(["2025-01-01", (100 / 3) * 2 - 1]);
  });
  it("함수", () => {
    expect(toPoints(evaluate(parse("ma(idx.11710, 2)"), data))[0]).toEqual(["2025-02-01", 101]);
    expect(toPoints(evaluate(parse("yoy(idx.11710)"), data))).toEqual([
      ["2026-01-01", 10.000000000000009],
      ["2026-02-01", 9.80392156862746],
    ]);
    expect(toPoints(evaluate(parse("rebase(idx.11710)"), data)).at(-1)![1]).toBeCloseTo(112, 9);
    expect(toPoints(evaluate(parse("-lag(ecos.base_rate, 1)"), data))[0]).toEqual(["2025-02-01", -3]);
  });
  it("오류", () => {
    expect(() => parse("idx.11710 +")).toThrow(ExprError);
    expect(() => parse("ma(idx.11710)")).toThrow(/n 은/);
    expect(() => parse("idx; drop table")).toThrow(ExprError);
    expect(() => evaluate(parse("nope.1"), data)).toThrow(/찾을 수 없습니다/);
  });
});
