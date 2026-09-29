import { describe, expect, it } from "vitest";
import { legacyPnu } from "../legacy-codes";

describe("legacyPnu", () => {
  it("전남광주통합특별시 새 코드를 옛 코드로 바꾼다", () => {
    expect(legacyPnu("1219031026201640013", "전남광주통합특별시", "광양시")).toBe("4623031026201640013");
    expect(legacyPnu("1215013300118840000", "전남광주통합특별시", "순천시")).toBe("4615013300118840000");
  });
  it("개편되지 않은 지역은 null", () => {
    expect(legacyPnu("4111710300113530000", "경기도", "수원시 영통구")).toBeNull();
    expect(legacyPnu("1219031026201640013", null, "광양시")).toBeNull();
  });
});
