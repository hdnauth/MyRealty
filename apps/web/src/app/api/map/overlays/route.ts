import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";

export type MapOverlays = {
  /** 정비구역 경계(경계 자료가 있는 구역만) */
  zones: { id: number; name: string; kind: string; step: number | null; coordinates: number[][][][] }[];
  /** 토지거래허가구역 · 지구단위계획구역 */
  regulations: { kind: "permit" | "district_plan"; name: string; coordinates: number[][][][] }[];
  /** 철도 노선(개략선)·도로 선형 */
  rails: { name: string; kind: "rail" | "road"; status: string; coordinates: number[][] }[];
  /** 계획 도로 부지(도시계획시설 도로 중 미집행·부분집행) — 동네 수준으로 확대했을 때만 */
  roads: { name: string; status: string; coordinates: number[][][][] }[];
};
const ROAD_SPAN = 0.15;

const MAX_SPAN = 0.6; // 너무 넓게 보면 경계는 생략(라벨·점만)

/**
 * 지도 덮개: 화면 범위(bbox=서,남,동,북)의 정비구역 경계·규제 구역·노선. layers=zones,permit,district_plan,rail(철도·도로)
 * 단순화한 GeoJSON 좌표만 돌려준다(가벼운 응답).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const b = (sp.get("bbox") ?? "").split(",").map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite)) return NextResponse.json({ error: "bbox" }, { status: 400 });
  const [w, s, e, n] = b;
  const layers = new Set((sp.get("layers") ?? "").split(","));
  const empty: MapOverlays = { zones: [], regulations: [], rails: [], roads: [] };
  if (e - w > MAX_SPAN || n - s > MAX_SPAN) return NextResponse.json({ ...empty, tooWide: true });
  const env = sql`ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)`;
  const regKinds = ["permit", "district_plan"].filter((k) => layers.has(k));
  const roadsOn = layers.has("rail") && e - w <= ROAD_SPAN && n - s <= ROAD_SPAN;
  const [zones, regulations, rails, roads] = await Promise.all([
    layers.has("zones")
      ? sql<{ id: number; name: string; kind: string; step: number | null; g: string }[]>`
          select id::int as id, name, kind, stage_order as step, ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.00003)), 6) as g
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
      ? sql<{ name: string; kind: "rail" | "road"; status: string; g: string }[]>`
          select name, kind, status, ST_AsGeoJSON(geom, 6) as g from infra_projects
          where kind in ('rail', 'road') and geom && ${env} and GeometryType(geom) = 'LINESTRING'
          limit 150`
      : [],
    roadsOn
      ? sql<{ name: string; status: string; g: string }[]>`
          select name, status, ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.00002)), 6) as g from infra_projects
          where kind = 'road' and geom && ${env} and GeometryType(geom) like '%POLYGON'
          limit 300`
      : [],
  ]);
  const coords = (g: string) => (JSON.parse(g) as { coordinates: unknown }).coordinates;
  const body: MapOverlays = {
    zones: zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind, step: z.step, coordinates: coords(z.g) as number[][][][] })),
    regulations: regulations
      .map((r) => ({ kind: r.kind, name: r.name, coordinates: coords(r.g) as number[][][][] }))
      .filter((r) => Array.isArray(r.coordinates) && r.coordinates.length > 0),
    rails: rails.map((r) => ({ name: r.name, kind: r.kind, status: r.status, coordinates: coords(r.g) as number[][] })),
    roads: roads.map((r) => ({ name: r.name, status: r.status, coordinates: coords(r.g) as number[][][][] })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
