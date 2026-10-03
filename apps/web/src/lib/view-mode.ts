import "server-only";
import { cookies } from "next/headers";

/**
 * 화면 보기 방식(쿠키). 기본 보기는 판정·이유를 먼저 보이고 z·회귀·분위 같은 수치는 접어 둔다.
 * 전문 보기는 모든 지표·검증 표를 펼쳐 보인다.
 */
export type ViewMode = "simple" | "pro";
export const VIEW_MODE_COOKIE = "view_mode";

export function isViewMode(v: unknown): v is ViewMode {
  return v === "simple" || v === "pro";
}

export async function getViewMode(): Promise<ViewMode> {
  const v = (await cookies()).get(VIEW_MODE_COOKIE)?.value;
  return isViewMode(v) ? v : "simple";
}
