import "server-only";
import { sql } from "../db";
import { env } from "../env";
import { vworldGeocode } from "./vworld";

async function naver(q: string): Promise<[number, number] | null> {
  if (!env.ncpKeyId || !env.ncpKey) return null;
  const res = await fetch(`https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(q)}`, {
    headers: { "x-ncp-apigw-api-key-id": env.ncpKeyId, "x-ncp-apigw-api-key": env.ncpKey },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  // 인증·권한 오류는 '결과 없음'이 아니므로 던져서 실패를 캐시하지 않게 한다
  if (!res.ok) throw new Error(`NCP geocode HTTP ${res.status}`);
  const a = (await res.json())?.addresses?.[0];
  return a ? [Number(a.x), Number(a.y)] : null;
}

/** 실패(좌표 없음) 캐시는 이만큼 지나면 다시 시도한다(키를 나중에 넣었거나 일시 오류였을 수 있다) */
const NEGATIVE_TTL = "3 days";

/**
 * 주소 → [lng, lat]. NCP Geocoding 우선, 없거나 실패하면 브이월드(지번 → 도로명 순).
 * 결과는 geocode_cache 에 저장(ETL 과 공유). 키가 없거나 호출 오류로 실패하면 실패를 캐시하지 않는다.
 */
export async function geocode(query: string): Promise<[number, number] | null> {
  const q = query.split(/\s+/).filter(Boolean).join(" ");
  if (!q) return null;
  const hit = await sql<{ lng: number | null; lat: number | null; stale: boolean }[]>`
    select lng, lat, (lng is null and fetched_at < now() - ${NEGATIVE_TTL}::interval) as stale from geocode_cache where query = ${q}`;
  if (hit.length && !hit[0].stale) return hit[0].lng !== null && hit[0].lat !== null ? [hit[0].lng, hit[0].lat] : null;
  if (!(env.ncpKeyId && env.ncpKey) && !env.vworldKey) return null;
  let pt: [number, number] | null = null;
  let provider: string | null = null;
  let errors = 0;
  const tries: [string, () => Promise<[number, number] | null>][] = [
    ["naver", () => naver(q)],
    ["vworld", () => vworldGeocode(q, "PARCEL")],
    ["vworld", () => vworldGeocode(q, "ROAD")],
  ];
  for (const [name, fn] of tries) {
    try {
      pt = await fn();
    } catch (e) {
      errors += 1;
      console.warn("[geocode]", name, e instanceof Error ? e.message : e);
      pt = null;
    }
    if (pt) {
      provider = name;
      break;
    }
  }
  if (!pt && errors) return null;
  await sql`insert into geocode_cache (query, lng, lat, provider) values (${q}, ${pt?.[0] ?? null}, ${pt?.[1] ?? null}, ${provider})
            on conflict (query) do update set lng = excluded.lng, lat = excluded.lat, provider = excluded.provider, fetched_at = now()`;
  return pt;
}

/** 좌표 후보 주소들(도로명 → 지번 → '산' 붙여 쓰기) */
export function geocodeQueries(road: string | null, jibun: string | null): string[] {
  const out = [road, jibun, jibun?.replace(/산\s+(\d)/, "산$1")].filter((s): s is string => Boolean(s && s.trim()));
  return [...new Set(out)];
}

/**
 * 좌표가 없는 관심 부동산을 지금 채운다(지도·주변 정보가 비지 않도록). 단지 좌표 → 주소 지오코딩 → 읍면동 중심 순.
 * 화면 요청마다 몇 개만 시도한다.
 */
export async function fillMissingItemGeoms(userId: string, limit = 5): Promise<number> {
  const rows = await sql<{ id: string; road_address: string | null; jibun_address: string | null; lawd_cd: string | null; complex_id: number | null }[]>`
    select id, road_address, jibun_address, lawd_cd, complex_id from watch_items
    where user_id = ${userId} and geom is null order by created_at desc limit ${limit}`;
  let n = 0;
  for (const w of rows) {
    let pt: [number, number] | null = null;
    if (w.complex_id) {
      const [c] = await sql<{ lng: number | null; lat: number | null }[]>`
        select ST_X(geom) as lng, ST_Y(geom) as lat from complexes where id = ${w.complex_id}`;
      if (c?.lng != null && c.lat != null) pt = [c.lng, c.lat];
    }
    for (const q of pt ? [] : geocodeQueries(w.road_address, w.jibun_address)) {
      pt = await geocode(q);
      if (pt) break;
    }
    if (!pt && w.lawd_cd) {
      const [r] = await sql<{ lng: number | null; lat: number | null }[]>`
        select ST_X(center) as lng, ST_Y(center) as lat from regions where lawd_cd = ${w.lawd_cd}`;
      if (r?.lng != null && r.lat != null) pt = [r.lng, r.lat];
    }
    if (!pt) continue;
    await sql`update watch_items set geom = ST_SetSRID(ST_MakePoint(${pt[0]}, ${pt[1]}), 4326), updated_at = now()
              where id = ${w.id} and geom is null`;
    n += 1;
  }
  return n;
}
