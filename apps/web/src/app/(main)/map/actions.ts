"use server";

import { ensureUser } from "@/lib/auth/session";
import { requestRegion } from "@/lib/coverage";

export type RegionRequestResult = { ok: boolean; message: string; status?: "enabled" | "pending" | "already" };

/** 지도 "이 지역 데이터 모으기"(방문자는 이 기기의 게스트 계정으로 남긴다) */
export async function requestRegionAction(lng: number, lat: number): Promise<RegionRequestResult> {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { ok: false, message: "위치가 올바르지 않습니다." };
  try {
    const user = await ensureUser();
    return await requestRegion(user.id, lng, lat);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
