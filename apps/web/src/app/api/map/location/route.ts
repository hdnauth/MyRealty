import { NextResponse, type NextRequest } from "next/server";
import { ensureComplexScores } from "@/lib/queries/location-live";

// 간이 점수는 OpenStreetMap 보충(수 초)을 기다릴 수 있다
export const maxDuration = 30;

/** 한 번에 물을 수 있는 단지 수(지도는 확대 15 이상에서 화면 안 단지만 묻는다) */
const MAX_IDS = 40;
/** 접속(IP)별 분당 요청 수 — 서버 인스턴스 메모리 기준의 가벼운 제한 */
const PER_MINUTE = 30;
const hits = new Map<string, { at: number; n: number }>();

function limited(req: NextRequest): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { at: now, n: 1 });
    return false;
  }
  h.n++;
  return h.n > PER_MINUTE;
}

/**
 * 지도 화면 안 단지의 입지 점수: 저장된 점수를 돌려주고, 없는 단지는 즉석으로 계산해 저장한다(lib/queries/location-live).
 *   GET /api/map/location?ids=1,2,3            — 화면 안 단지(가운데에 가까운 순)
 *   GET /api/map/location?ids=7&priority=1     — 사용자가 고른 단지 하나(한도를 넉넉히)
 * → { scores: { [id]: { total, basis, cats } }, pending: [id…] } — pending 은 한도 때문에 이번에 계산하지 못한 단지
 */
export async function GET(req: NextRequest) {
  const ids = [...new Set((req.nextUrl.searchParams.get("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ error: "ids" }, { status: 400 });
  if (limited(req)) return NextResponse.json({ error: "잠시 뒤 다시 시도하세요." }, { status: 429 });
  const priority = req.nextUrl.searchParams.get("priority") === "1" && ids.length === 1;
  try {
    const out = await ensureComplexScores(ids, priority ? { maxFull: 1, maxQuick: 1, signal: req.signal } : { signal: req.signal });
    // 남은 단지가 있으면 곧 같은 주소로 다시 묻는다 — 그때는 브라우저 캐시를 쓰면 안 된다
    return NextResponse.json(out, { headers: { "Cache-Control": out.pending.length ? "no-store" : "private, max-age=60" } });
  } catch (e) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    throw e;
  }
}
