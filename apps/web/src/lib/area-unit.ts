import "server-only";
import { cookies } from "next/headers";
import { AREA_UNIT_COOKIE, type AreaUnit, isAreaUnit } from "./format";

/** 설정 › 표시 단위(쿠키). 기본은 ㎡(법정 단위) 우선 */
export async function getAreaUnit(): Promise<AreaUnit> {
  const v = (await cookies()).get(AREA_UNIT_COOKIE)?.value;
  return isAreaUnit(v) ? v : "m2";
}
