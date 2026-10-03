import { describe, expect, it } from "vitest";
import fixture from "./fixtures/location-parity.json";
import { scorePoint, type ScorePoi } from "../location-score";

/**
 * Python(ETL) 과 같은 입력에 같은 점수를 내는지 — 묶음은 services/etl/tests/test_location_parity.py 가 만든다.
 * 반올림 방식(Python 은 은행가 반올림: 82866.5 → 82866)만 다를 수 있어 숫자는 0.1 또는 0.01% 까지 허용한다.
 */
type Case = { lng: number | null; lat: number | null; available: string[]; pois: ScorePoi[]; expected: { total: number | null; scores: unknown } };

function close(a: unknown, b: unknown, path = "$"): string | null {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= Math.max(0.1 + 1e-9, Math.abs(b) * 1e-4) ? null : `${path}: ${a} != ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const e = close(a[i], b[i], `${path}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${path}: keys ${ka} != ${kb}`;
    for (const k of ka) {
      const e = close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (e) return e;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

describe("location score parity with ETL", () => {
  (fixture.cases as Case[]).forEach((c, i) => {
    it(`case ${i}`, () => {
      const [total, scores] = scorePoint(c.pois, new Set(c.available), c.lng ?? undefined, c.lat ?? undefined);
      expect(close({ total, scores }, c.expected)).toBeNull();
    });
  });
});
