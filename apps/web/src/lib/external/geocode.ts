import "server-only";
import { sql } from "../db";
import { env } from "../env";

/** 주소 → [lng, lat]. NCP Geocoding 사용, 결과는 geocode_cache 에 저장(ETL 과 공유). */
export async function geocode(query: string): Promise<[number, number] | null> {
  const q = query.split(/\s+/).filter(Boolean).join(" ");
  if (!q) return null;
  const hit = await sql<{ lng: number | null; lat: number | null }[]>`select lng, lat from geocode_cache where query = ${q}`;
  if (hit.length) return hit[0].lng !== null && hit[0].lat !== null ? [hit[0].lng, hit[0].lat] : null;
  if (!env.ncpKeyId || !env.ncpKey) return null;
  const res = await fetch(`https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(q)}`, {
    headers: { "x-ncp-apigw-api-key-id": env.ncpKeyId, "x-ncp-apigw-api-key": env.ncpKey },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  const a = data?.addresses?.[0];
  const pt: [number, number] | null = a ? [Number(a.x), Number(a.y)] : null;
  await sql`insert into geocode_cache (query, lng, lat, provider) values (${q}, ${pt?.[0] ?? null}, ${pt?.[1] ?? null}, 'naver')
            on conflict (query) do nothing`;
  return pt;
}
