import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";

export type MapOverlays = {
  /** 정비구역 경계(경계 자료가 있는 구역만) */
  zones: { id: number; name: string; step: number | null; coordinates: number[][][][] }[];
  /** 토지거래허가구역 · 지구단위계획구역 */
  regulations: { kind: "permit" | "district_plan"; name: string; coordinates: number[][][][] }[];
  /** 철도 노선(개략선) */
  rails: { name: string; status: string; coordinates: number[][] }[];
};

const MAX_SPAN = 0.6; // 너무 넓게 보면 경계는 생략(라벨·점만)

/**
 * 지도 덮개: 화면 범위(bbox=서,남,동,북)의 정비구역 경계·규제 구역·노선. layers=zones,permit,district_plan,rail
 * 단순화한 GeoJSON 좌표만 돌려준다(가벼운 응답).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const b = (sp.get("bbox") ?? "").split(",").map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite)) return NextResponse.json({ error: "bbox" }, { status: 400 });
  const [w, s, e, n] = b;
  const layers = new Set((sp.get("layers") ?? "").split(","));
  const empty: MapOverlays = { zones: [], regulations: [], rails: [] };
  if (e - w > MAX_SPAN || n - s > MAX_SPAN) return NextResponse.json({ ...empty, tooWide: true });
  const env = sql`ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)`;
  const regKinds = ["permit", "district_plan"].filter((k) => layers.has(k));
  const [zones, regulations, rails] = await Promise.all([
    layers.has("zones")
      ? sql<{ id: number; name: string; step: number | null; g: string }[]>`
          select id::int as id, name, stage_order as step, ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.00003)), 6) as g
          from redevelopment_zones
          where geom && ${env} and GeometryType(geom) like '%POLYGON' and stage_order is distinct from 9
          limit 400`
      : [],
    regKinds.length
      ? sql<{ kind: "permit" | "district_plan"; name: string; g: string }[]>`
          select kind, name, ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(ST_CollectionExtract(ST_Intersection(geom, ${env}), 3), 0.00005)), 6) as g
          from regulation_areas where geom && ${env} and kind = any(${regKinds})
          limit 300`
      : [],
    layers.has("rail")
      ? sql<{ name: string; status: string; g: string }[]>`
          select name, status, ST_AsGeoJSON(geom, 6) as g from infra_projects
          where kind = 'rail' and geom && ${env} and GeometryType(geom) = 'LINESTRING'
          limit 100`
      : [],
  ]);
  const coords = (g: string) => (JSON.parse(g) as { coordinates: unknown }).coordinates;
  const body: MapOverlays = {
    zones: zones.map((z) => ({ id: z.id, name: z.name, step: z.step, coordinates: coords(z.g) as number[][][][] })),
    regulations: regulations
      .map((r) => ({ kind: r.kind, name: r.name, coordinates: coords(r.g) as number[][][][] }))
      .filter((r) => Array.isArray(r.coordinates) && r.coordinates.length > 0),
    rails: rails.map((r) => ({ name: r.name, status: r.status, coordinates: coords(r.g) as number[][] })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
