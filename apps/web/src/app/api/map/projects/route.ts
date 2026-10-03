import { NextResponse, type NextRequest } from "next/server";
import type { MapProject } from "@/components/map/realty-map";
import { sql } from "@/lib/db";

const MAX_SPAN = 1.2; // 이보다 넓게 보면 점이 너무 많아 그리지 않는다
const ROAD_SPAN = 0.15; // 계획 도로는 동네 수준으로 확대했을 때만(수가 많고 작다)

/**
 * 지도 개발사업 점: 화면 범위(bbox=서,남,동,북) 안의 정비구역(준공 제외)·철도/역·계획 도로. layers=zones,infra
 * 예전에는 지도 페이지가 전국 사업을 한꺼번에(최대 3,000건) 내려보냈다 — 레이어를 켰을 때 화면 안만 받는다.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const b = (sp.get("bbox") ?? "").split(",").map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite)) return NextResponse.json({ error: "bbox" }, { status: 400 });
  const [w, s, e, n] = b;
  if (e - w > MAX_SPAN || n - s > MAX_SPAN) return NextResponse.json({ projects: [], tooWide: true });
  const layers = new Set((sp.get("layers") ?? "").split(","));
  const env = sql`ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)`;
  const roads = e - w <= ROAD_SPAN && n - s <= ROAD_SPAN;
  const [zones, infra] = await Promise.all([
    layers.has("zones")
      ? sql<MapProject[]>`
          select 'zone' as type, id::int as id, name, kind, stage as status, stage_order as step, null::text as expected_open,
            ST_X(ST_PointOnSurface(geom)) as lng, ST_Y(ST_PointOnSurface(geom)) as lat,
            coalesce((attrs->>'candidate')::boolean, false) as candidate, area_m2::float8 as area_m2
          from redevelopment_zones where geom && ${env} and stage_order is distinct from 9
          limit 600`
      : [],
    layers.has("infra")
      ? sql<MapProject[]>`
          select 'infra' as type, id::int as id, name, kind, status, status_order as step, expected_open::text as expected_open,
            ST_X(ST_PointOnSurface(geom)) as lng, ST_Y(ST_PointOnSurface(geom)) as lat, attrs->>'notice_date' as notice_date
          from infra_projects where geom && ${env} and (kind <> 'road' or ${roads})
          order by kind <> 'road' desc
          limit 400`
      : [],
  ]);
  return NextResponse.json({ projects: [...zones, ...infra] }, { headers: { "Cache-Control": "private, max-age=300" } });
}
