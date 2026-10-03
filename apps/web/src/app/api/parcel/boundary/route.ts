import { NextResponse, type NextRequest } from "next/server";
import { parcelBoundaries } from "@/lib/external/parcel-boundary";

/** 필지 경계: GET /api/parcel/boundary?pnu=1219031026201640013,4111710300113530000 → { boundaries: { pnu: MultiPolygon 좌표 | null } } */
export async function GET(req: NextRequest) {
  const pnus = (req.nextUrl.searchParams.get("pnu") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return NextResponse.json({ boundaries: await parcelBoundaries(pnus) }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
