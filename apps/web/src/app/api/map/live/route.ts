import { NextResponse, type NextRequest } from "next/server";
import { coverageAt } from "@/lib/coverage";
import { env } from "@/lib/env";
import { livePoints } from "@/lib/live-preview";
import { type DealKind, kindFor } from "@/lib/map-filters";

export const maxDuration = 30;

const TYPES = new Set(["apt", "officetel", "rowhouse", "house", "land", "commercial"]);

/**
 * 수집 전 지역 미리보기(bbox=서,남,동,북 · type · kind): 화면 가운데 시군구가 아직 실거래를 모으지 않은 곳이면
 * 공공 API 최근 3개월 거래를 동네별(넓게)·단지별(확대) 점으로 돌려준다. 수집 중이고 거래가 있는 곳이면 빈 목록.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const b = (sp.get("bbox") ?? "").split(",").map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite)) return NextResponse.json({ error: "bbox" }, { status: 400 });
  const [w, s, e, n] = b;
  const lng = (w + e) / 2;
  const lat = (s + n) / 2;
  if (e - w > 0.3 || lng < 124 || lng > 132 || lat < 33 || lat > 39) return NextResponse.json({ coverage: null, points: [] });
  const type = TYPES.has(sp.get("type") ?? "") ? sp.get("type")! : "apt";
  const raw = sp.get("kind");
  const kind = kindFor(type, raw === "jeonse" || raw === "wolse" ? (raw as DealKind) : "sale");
  try {
    const coverage = await coverageAt(lng, lat);
    if (!coverage || (coverage.collected && coverage.ready) || !env.dataGoKrKey) {
      return NextResponse.json({ coverage, points: [] });
    }
    const out = await livePoints({ sgg: coverage.sgg, regionName: coverage.name, type, kind, bbox: [w, s, e, n] });
    return NextResponse.json({ coverage, ...out }, { headers: { "Cache-Control": "private, max-age=120" } });
  } catch (err) {
    console.warn("[live]", err instanceof Error ? err.message : err);
    return NextResponse.json({ coverage: null, points: [], error: true });
  }
}
