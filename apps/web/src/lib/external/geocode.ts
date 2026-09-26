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
  if (!res.ok) return null;
  const a = (await res.json())?.addresses?.[0];
  return a ? [Number(a.x), Number(a.y)] : null;
}

/**
 * 주소 → [lng, lat]. NCP Geocoding 우선, 없거나 실패하면 브이월드(지번 → 도로명 순).
 * 결과는 geocode_cache 에 저장(ETL 과 공유). 키가 하나도 없으면 실패를 캐시하지 않는다.
 */
export async function geocode(query: string): Promise<[number, number] | null> {
  const q = query.split(/\s+/).filter(Boolean).join(" ");
  if (!q) return null;
  const hit = await sql<{ lng: number | null; lat: number | null }[]>`select lng, lat from geocode_cache where query = ${q}`;
  if (hit.length) return hit[0].lng !== null && hit[0].lat !== null ? [hit[0].lng, hit[0].lat] : null;
  if (!(env.ncpKeyId && env.ncpKey) && !env.vworldKey) return null;
  let pt: [number, number] | null = null;
  let provider: string | null = null;
  const tries: [string, () => Promise<[number, number] | null>][] = [
    ["naver", () => naver(q)],
    ["vworld", () => vworldGeocode(q, "PARCEL")],
    ["vworld", () => vworldGeocode(q, "ROAD")],
  ];
  for (const [name, fn] of tries) {
    try {
      pt = await fn();
    } catch {
      pt = null;
    }
    if (pt) {
      provider = name;
      break;
    }
  }
  await sql`insert into geocode_cache (query, lng, lat, provider) values (${q}, ${pt?.[0] ?? null}, ${pt?.[1] ?? null}, ${provider})
            on conflict (query) do nothing`;
  return pt;
}
