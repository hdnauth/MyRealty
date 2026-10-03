import { NextResponse, type NextRequest } from "next/server";
import { coverageAt } from "@/lib/coverage";

/** 지도 가운데 좌표의 시군구와 수집 여부(빈 화면이 '거래 없음'인지 '아직 안 모음'인지 구분) */
export async function GET(req: NextRequest) {
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  // 대한민국 대략 범위 밖은 묻지 않는다
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < 124 || lng > 132 || lat < 33 || lat > 39) {
    return NextResponse.json({ coverage: null });
  }
  try {
    return NextResponse.json({ coverage: await coverageAt(lng, lat) });
  } catch (e) {
    console.warn("[coverage]", e instanceof Error ? e.message : e);
    return NextResponse.json({ coverage: null });
  }
}
