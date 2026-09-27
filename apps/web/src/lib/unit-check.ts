import "server-only";
import { env } from "./env";
import { getUnits } from "./external/building";
import { PROPERTY_TYPES, type PropertyType } from "./property";
import { normDong, normHo, parseDongHo } from "./units";

export type UnitCheck = { area: number | null; floor: number | null; error?: string };

/**
 * 등록·수정 때 면적이 실제 건물에 있는 값인지 확인한다(건축물대장 전유부 기준).
 * - 동·호를 고르면 그 호의 전용면적·층을 쓴다(입력한 면적보다 우선).
 * - 호 없이 면적만 있으면 대장에 있는 면적이어야 한다(±0.5㎡ 안이면 대장 값으로 맞춘다).
 * 대장을 못 불러오면(키 없음·API 오류) 입력값을 그대로 둔다 — 등록 자체를 막지 않는다.
 */
export async function checkUnitArea(pnu: string | null, type: PropertyType, dongHoText: string | null, area: number | null): Promise<UnitCheck> {
  const pass: UnitCheck = { area, floor: null };
  if (!pnu || !env.dataGoKrKey || !(PROPERTY_TYPES[type].hasComplex || type === "commercial")) return pass;
  let units;
  let partial = false;
  try {
    const r = await getUnits(pnu);
    units = r.units;
    partial = r.partial;
  } catch {
    return pass;
  }
  if (!units.length) return pass;
  const { dong, ho } = parseDongHo(dongHoText);
  if (ho) {
    const cands = units.filter((u) => normHo(u.ho) === normHo(ho) && (!dong || normDong(u.dong) === normDong(dong)));
    // 동을 안 적었는데 같은 호가 여러 동에 있으면 면적으로 좁힌다
    const hit = cands.length === 1 ? cands[0] : area ? cands.find((u) => Math.abs(u.area - area) <= 0.5) ?? null : null;
    if (hit) return { area: hit.area, floor: hit.floor };
    if (!cands.length && !partial) return { ...pass, error: `${dongHoText} 은(는) 건축물대장에 없는 호입니다. 목록에서 고르거나 동·호를 확인하세요.` };
  }
  if (area === null) return pass;
  const nearest = units.reduce((a, b) => (Math.abs(b.area - area) < Math.abs(a.area - area) ? b : a));
  if (Math.abs(nearest.area - area) <= 0.5) return { area: nearest.area, floor: null };
  const list = [...new Set(units.map((u) => Math.round(u.area * 10) / 10))].sort((a, b) => a - b).slice(0, 8);
  return { ...pass, error: `이 건물에 없는 전용면적(${area}㎡)입니다. 대장 기준 면적: ${list.join(", ")}㎡${list.length === 8 ? " …" : ""} — 평형 목록에서 고르세요.` };
}
