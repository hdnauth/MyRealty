import "server-only";
import { sql } from "../db";
import { env } from "../env";
import { legacyPnu } from "../legacy-codes";

/** GeoJSON MultiPolygon 좌표([경도, 위도]) */
export type MultiPolygonCoords = number[][][][];

/** 못 찾은 필지는 이 기간 동안 다시 묻지 않는다 */
const MISS_TTL = "7 days";
/** 경계는 분할·합병 때만 바뀌므로 오래 쓴다 */
const HIT_TTL = "180 days";

/**
 * 필지 경계(브이월드 연속지적도 LP_PA_CBND_BUBUN). parcels.boundary 에 캐시하고, 없거나 오래됐으면 받아 온다.
 * 토지·임야 관심 부동산의 좌표가 필지 밖이면(주소 지오코딩이 읍면 중심 등을 준 경우) 필지 안쪽 지점으로 옮긴다.
 */
export async function parcelBoundaries(pnus: string[]): Promise<Record<string, MultiPolygonCoords | null>> {
  const list = [...new Set(pnus.filter((p) => /^\d{19}$/.test(p)))].slice(0, 30);
  if (!list.length) return {};
  const rows = await sql<{ pnu: string; geojson: string | null; fresh: boolean }[]>`
    select pnu, ST_AsGeoJSON(boundary, 7) as geojson,
      coalesce(boundary_at > now() - case when boundary is null then ${MISS_TTL}::interval else ${HIT_TTL}::interval end, false) as fresh
    from parcels where pnu = any(${list})`;
  const out: Record<string, MultiPolygonCoords | null> = {};
  const byPnu = new Map(rows.map((r) => [r.pnu, r]));
  const stale: string[] = [];
  for (const p of list) {
    const r = byPnu.get(p);
    if (r?.fresh) out[p] = r.geojson ? (JSON.parse(r.geojson).coordinates as MultiPolygonCoords) : null;
    else stale.push(p);
  }
  if (stale.length && env.vworldKey) {
    await Promise.all(
      stale.map(async (p) => {
        try {
          out[p] = await fetchAndStore(p);
        } catch (e) {
          console.warn("[parcel-boundary]", p, e instanceof Error ? e.message : e);
          const r = byPnu.get(p);
          out[p] = r?.geojson ? (JSON.parse(r.geojson).coordinates as MultiPolygonCoords) : null;
        }
      }),
    );
  }
  return out;
}

async function fetchAndStore(pnu: string): Promise<MultiPolygonCoords | null> {
  let geom = await fetchVworld(pnu);
  if (!geom) {
    // 행정구역 개편 지역: 연속지적도가 옛 코드로만 있을 때
    const [reg] = await sql<{ sido: string | null; sigungu: string | null }[]>`
      select sido, sigungu from regions where lawd_cd = ${`${pnu.slice(0, 5)}00000`}`;
    const old = legacyPnu(pnu, reg?.sido, reg?.sigungu);
    if (old) geom = await fetchVworld(old);
  }
  const json = geom ? JSON.stringify(geom) : null;
  await sql`
    insert into parcels (pnu, lawd_cd, boundary, boundary_at)
    values (${pnu}, ${pnu.slice(0, 10)}, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${json}::text), 4326)), now())
    on conflict (pnu) do update set boundary = excluded.boundary, boundary_at = now()`;
  if (json) {
    await sql`
      update watch_items w set geom = ST_PointOnSurface(p.boundary), updated_at = now()
      from parcels p
      where p.pnu = ${pnu} and w.pnu = p.pnu and w.property_type in ('land', 'forest')
        and (w.geom is null or not ST_Intersects(w.geom, p.boundary))`;
  }
  return geom ? (geom.type === "Polygon" ? [geom.coordinates as number[][][]] : (geom.coordinates as MultiPolygonCoords)) : null;
}

async function fetchVworld(pnu: string): Promise<{ type: string; coordinates: unknown } | null> {
  const q = new URLSearchParams({
    service: "data",
    request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",
    attrFilter: `pnu:=:${pnu}`,
    geometry: "true",
    attribute: "false",
    format: "json",
    crs: "EPSG:4326",
    size: "1",
    key: env.vworldKey ?? "",
  });
  if (env.vworldDomain) q.set("domain", env.vworldDomain);
  const res = await fetch(`https://api.vworld.kr/req/data?${q}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  const resp = (await res.json())?.response;
  if (resp?.status === "NOT_FOUND") return null;
  if (resp?.status !== "OK") throw new Error(`VWorld data ${resp?.error?.code ?? res.status}`);
  const g = resp.result?.featureCollection?.features?.[0]?.geometry;
  return g && (g.type === "MultiPolygon" || g.type === "Polygon") ? g : null;
}
