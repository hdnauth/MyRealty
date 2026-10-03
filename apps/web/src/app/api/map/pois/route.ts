import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { ensureOsmPois } from "@/lib/external/osm";

const ALLOWED = new Set(["subway", "school", "park", "hospital", "mart"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bbox = (sp.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) return NextResponse.json({ error: "bbox" }, { status: 400 });
  const cats = (sp.get("cats") ?? "").split(",").filter((c) => ALLOWED.has(c));
  if (!cats.length) return NextResponse.json({ pois: [] });
  // 수집된 시설(공공데이터·CSV)이 없는 곳도 비지 않게 OpenStreetMap 으로 보충
  const note = await ensureOsmPois(bbox as [number, number, number, number]).catch(() => null);
  const pois = await sql<{ id: number; category: string; subcategory: string | null; name: string; lng: number; lat: number }[]>`
    select id, category, subcategory, name, ST_X(geom) as lng, ST_Y(geom) as lat from pois
    where category = any(${cats}) and geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)
    order by case source when 'osm' then 1 else 0 end, id
    limit 600`;
  return NextResponse.json({ pois, note });
}
