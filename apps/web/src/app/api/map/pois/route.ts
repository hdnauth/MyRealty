import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

const ALLOWED = new Set(["subway", "school", "park", "hospital", "mart"]);

export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const bbox = (sp.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) return NextResponse.json({ error: "bbox" }, { status: 400 });
  const cats = (sp.get("cats") ?? "").split(",").filter((c) => ALLOWED.has(c));
  if (!cats.length) return NextResponse.json({ pois: [] });
  const pois = await sql<{ id: number; category: string; subcategory: string | null; name: string; lng: number; lat: number }[]>`
    select id, category, subcategory, name, ST_X(geom) as lng, ST_Y(geom) as lat from pois
    where category = any(${cats}) and geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)
    limit 500`;
  return NextResponse.json({ pois });
}
