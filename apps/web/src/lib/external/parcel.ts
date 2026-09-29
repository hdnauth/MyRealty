import "server-only";
import { env } from "../env";
import { parsePnu, splitRegion } from "../parcel-parse";

export { looksLikeJibun, parsePnu, splitRegion } from "../parcel-parse";

/**
 * 지번(필지) 검색. 도로명주소 API(juso)는 건물이 있는 주소만 돌려줘 건물 없는 토지·임야("조령리 산 164-1")가 안 나온다.
 * 그런 필지는 브이월드 주소 검색(category=parcel, 결과 id 가 PNU)으로 찾고, 브이월드 키가 없거나 실패하면
 * 네이버 지오코딩 → 역지오코딩(법정동코드·지번)으로 찾는다.
 */
export type ParcelHit = {
  pnu: string;
  address: string;
  sidoName: string | null;
  sggName: string | null;
  emdName: string | null;
  lng: number | null;
  lat: number | null;
};

async function vworldSearch(q: string, size: number): Promise<ParcelHit[]> {
  if (!env.vworldKey) return [];
  const params = new URLSearchParams({
    service: "search",
    request: "search",
    version: "2.0",
    crs: "EPSG:4326",
    size: String(size),
    page: "1",
    query: q,
    type: "address",
    category: "parcel",
    format: "json",
    errorformat: "json",
    key: env.vworldKey,
  });
  if (env.vworldDomain) params.set("domain", env.vworldDomain);
  const res = await fetch(`https://api.vworld.kr/req/search?${params}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  const resp = (await res.json())?.response;
  if (resp?.status === "NOT_FOUND") return [];
  if (resp?.status !== "OK") throw new Error(`브이월드 검색 ${resp?.error?.code ?? res.status}: ${resp?.error?.text ?? ""}`.trim());
  const items: { id?: string; address?: { parcel?: string }; point?: { x?: string; y?: string } }[] = resp.result?.items ?? [];
  return items
    .filter((it) => /^\d{19}$/.test(it.id ?? "") && it.address?.parcel)
    .map((it) => ({
      pnu: it.id!,
      address: it.address!.parcel!,
      ...splitRegion(it.address!.parcel!),
      lng: Number(it.point?.x) || null,
      lat: Number(it.point?.y) || null,
    }));
}

type NcpArea = { name?: string };
async function ncpSearch(q: string): Promise<ParcelHit[]> {
  if (!env.ncpKeyId || !env.ncpKey) return [];
  const headers = { "x-ncp-apigw-api-key-id": env.ncpKeyId, "x-ncp-apigw-api-key": env.ncpKey };
  const res = await fetch(`https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(q)}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`네이버 지오코딩 HTTP ${res.status}`);
  const addrs: { x: string; y: string; jibunAddress?: string }[] = (await res.json())?.addresses ?? [];
  const out: ParcelHit[] = [];
  for (const a of addrs.slice(0, 5)) {
    const r = await fetch(`https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${a.x},${a.y}&orders=addr&output=json`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) continue;
    const g = (await r.json())?.results?.[0];
    const code: string | undefined = g?.code?.id;
    const land = g?.land;
    if (!code || code.length !== 10 || !land?.number1) continue;
    const mountain = String(land.type) === "2";
    const pnu = `${code}${mountain ? 2 : 1}${String(Number(land.number1)).padStart(4, "0")}${String(Number(land.number2 || 0)).padStart(4, "0")}`;
    const reg: Record<string, NcpArea> = g.region ?? {};
    const emd = [reg.area3?.name, reg.area4?.name].filter(Boolean).join(" ");
    out.push({
      pnu,
      address: a.jibunAddress || [reg.area1?.name, reg.area2?.name, emd, parsePnu(pnu)?.jibun].filter(Boolean).join(" "),
      sidoName: reg.area1?.name ?? null,
      sggName: reg.area2?.name ?? null,
      emdName: emd || null,
      lng: Number(a.x),
      lat: Number(a.y),
    });
  }
  return out;
}

/** 필지 검색(브이월드 → 네이버). 둘 다 없으면 빈 목록, 둘 다 실패하면 마지막 오류를 던진다 */
export async function searchParcels(q: string, size = 10): Promise<ParcelHit[]> {
  let err: unknown = null;
  for (const fn of [vworldSearch, ncpSearch]) {
    try {
      const hits = await fn(q, size);
      if (hits.length) {
        const seen = new Set<string>();
        return hits.filter((h) => !seen.has(h.pnu) && seen.add(h.pnu));
      }
    } catch (e) {
      err = e;
    }
  }
  if (err) throw err;
  return [];
}
