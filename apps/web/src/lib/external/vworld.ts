import "server-only";
import { sql } from "../db";
import { env } from "../env";
import { legacyPnu } from "../legacy-codes";

/** 브이월드 공통 파라미터(서비스 URL 을 등록한 키는 domain 을 함께 보내야 한다) */
function withKey(params: Record<string, string>) {
  const q = new URLSearchParams({ key: env.vworldKey ?? "", ...params });
  if (env.vworldDomain) q.set("domain", env.vworldDomain);
  return q;
}

/** 토지특성(지목·면적). ETL 이 모은 parcels 가 있으면 그 값을 쓴다(지목이 빈 행은 예전 실패 결과라 다시 받는다) */
export async function landCharacteristics(
  pnu: string,
  region?: { sido?: string | null; sigungu?: string | null },
): Promise<{ jimok: string | null; area: number | null } | null> {
  const [hit] = await sql<{ jimok: string | null; area_m2: number | null }[]>`select jimok, area_m2 from parcels where pnu = ${pnu}`;
  if (hit?.jimok) return { jimok: hit.jimok, area: hit.area_m2 };
  if (!env.vworldKey) return null;
  // 행정구역 개편 지역은 브이월드가 옛 코드로만 답한다
  const r = (await fetchLandCharacteristics(pnu)) ?? (await legacyLookup(pnu, region));
  return r;
}

async function legacyLookup(pnu: string, region?: { sido?: string | null; sigungu?: string | null }) {
  let { sido, sigungu } = region ?? {};
  if (!sido || !sigungu) {
    const [row] = await sql<{ sido: string | null; sigungu: string | null }[]>`
      select sido, sigungu from regions where lawd_cd = ${`${pnu.slice(0, 5)}00000`}`;
    sido ||= row?.sido;
    sigungu ||= row?.sigungu;
  }
  const old = legacyPnu(pnu, sido, sigungu);
  return old ? fetchLandCharacteristics(old) : null;
}

async function fetchLandCharacteristics(pnu: string): Promise<{ jimok: string | null; area: number | null } | null> {
  const res = await fetch(
    `https://api.vworld.kr/ned/data/getLandCharacteristics?${withKey({ pnu, format: "json", numOfRows: "10", pageNo: "1" })}`,
    { cache: "no-store", signal: AbortSignal.timeout(8_000) },
  );
  const data = await res.json();
  const block = data?.landCharacteristicss;
  const code = block?.resultCode;
  if (code && !["INFO-000", "0"].includes(code)) throw new Error(`VWorld ${code}: ${block?.resultMsg ?? ""}`);
  const rows: Record<string, string>[] = Array.isArray(block?.field) ? block.field : block?.field ? [block.field] : [];
  if (!rows.length) return null;
  const r = rows.reduce((a, b) => (Number(b.stdrYear) > Number(a.stdrYear) ? b : a));
  const area = Number(r.lndpclAr);
  return { jimok: r.lndcgrCodeNm ?? null, area: Number.isFinite(area) && area > 0 ? area : null };
}

/** 주소 → [lng, lat] (지번 PARCEL / 도로명 ROAD) */
export async function vworldGeocode(address: string, kind: "PARCEL" | "ROAD"): Promise<[number, number] | null> {
  if (!env.vworldKey) return null;
  const q = withKey({
    service: "address",
    request: "getcoord",
    version: "2.0",
    crs: "epsg:4326",
    address,
    refine: "true",
    simple: "false",
    format: "json",
    type: kind,
  });
  const res = await fetch(`https://api.vworld.kr/req/address?${q}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  const resp = (await res.json())?.response;
  if (resp?.status === "NOT_FOUND") return null;
  // 키·도메인 오류는 '결과 없음'과 구분(실패를 캐시하지 않도록 던진다)
  if (resp?.status !== "OK") throw new Error(`VWorld geocode ${resp?.error?.code ?? res.status}`);
  const x = Number(resp.result?.point?.x);
  const y = Number(resp.result?.point?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/** 좌표 → 법정동(코드·시도·시군구·읍면동). 바다·국외 등 결과가 없으면 null */
export async function vworldReverse(lng: number, lat: number): Promise<{ lawdCd: string; sido: string; sigungu: string; emd: string } | null> {
  if (!env.vworldKey) return null;
  const q = withKey({
    service: "address",
    request: "getAddress",
    version: "2.0",
    crs: "epsg:4326",
    point: `${lng},${lat}`,
    format: "json",
    type: "PARCEL",
    zipcode: "false",
    simple: "false",
  });
  const res = await fetch(`https://api.vworld.kr/req/address?${q}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  const resp = (await res.json())?.response;
  if (resp?.status === "NOT_FOUND") return null;
  if (resp?.status !== "OK") throw new Error(`VWorld reverse ${resp?.error?.code ?? res.status}`);
  const st = resp.result?.[0]?.structure;
  const code = String(st?.level4LC ?? "");
  if (!/^\d{10}$/.test(code)) return null;
  return { lawdCd: code, sido: st.level1 ?? "", sigungu: st.level2 ?? "", emd: st.level4L ?? "" };
}
