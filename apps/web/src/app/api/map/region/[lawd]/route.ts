import { NextResponse, type NextRequest } from "next/server";
import { isRegionType, regionMarket } from "@/lib/queries/region-market";

/** 지도 선택 카드: 단지가 없는 유형의 읍면동 거래(최근 3년, 최대 150건)·세부 유형별 요약 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/map/region/[lawd]">) {
  const lawd = (await ctx.params).lawd;
  const type = req.nextUrl.searchParams.get("type");
  if (!/^\d{10}$/.test(lawd) || !isRegionType(type)) return NextResponse.json({ error: "lawd/type" }, { status: 400 });
  const m = await regionMarket(lawd, type, { years: 3, limit: 150 });
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(m);
}
