import "server-only";
import { sql } from "./db";
import { env } from "./env";
import { vworldReverse } from "./external/vworld";

export type Coverage = {
  sgg: string;
  name: string;
  /** 매일 실거래를 모으는 시군구 */
  collected: boolean;
  /** 이 시군구에 운영자 확인을 기다리는 요청이 있음 */
  pending: boolean;
  /** 수집된 실거래가 하나라도 있음(수집을 막 켠 지역은 false) */
  ready: boolean;
};

type Region = { sgg: string; lawdCd: string; sido: string; sigungu: string; name: string };

// 같은 1km 격자는 다시 묻지 않는다(브이월드 호출 절약). 인스턴스 메모리라 재시작하면 비워진다.
const memo = new Map<string, Region | null>();
const MEMO_MAX = 5000;

/** 좌표 → 시군구(브이월드 역지오코딩, 약 1km 격자 캐시) */
export async function regionAt(lng: number, lat: number): Promise<Region | null> {
  const key = `${lng.toFixed(2)},${lat.toFixed(2)}`;
  if (memo.has(key)) return memo.get(key)!;
  const r = await vworldReverse(lng, lat);
  const region = r ? { sgg: r.lawdCd.slice(0, 5), lawdCd: r.lawdCd, sido: r.sido, sigungu: r.sigungu, name: [r.sido, r.sigungu].filter(Boolean).join(" ") } : null;
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value!);
  memo.set(key, region);
  return region;
}

export async function coverageAt(lng: number, lat: number): Promise<Coverage | null> {
  const r = await regionAt(lng, lat);
  if (!r) return null;
  const [row] = await sql<{ collected: boolean; pending: boolean; ready: boolean }[]>`
    select exists (select 1 from collect_targets where sgg_cd = ${r.sgg} and enabled) as collected,
      exists (select 1 from region_requests where sgg_cd = ${r.sgg} and status = 'pending') as pending,
      exists (select 1 from transactions where sgg_cd = ${r.sgg}) as ready`;
  return { sgg: r.sgg, name: r.name, collected: Boolean(row?.collected), pending: Boolean(row?.pending), ready: Boolean(row?.ready) };
}

export const REGION_REQUESTS_PER_DAY = 3;

/**
 * "이 지역 데이터 모으기": 수집 대상을 켠다(다음 매일 수집부터 최근 3개월 → 과거 순으로 채움).
 * 사용자당 하루 3곳, 켜져 있는 수집 대상이 상한(REGION_TARGET_CAP)을 넘으면 대기 요청으로만 남긴다.
 */
export async function requestRegion(userId: string, lng: number, lat: number): Promise<{ ok: boolean; message: string; status?: "enabled" | "pending" | "already" }> {
  const r = await regionAt(lng, lat);
  if (!r) return { ok: false, message: "이 위치의 시군구를 찾지 못했습니다. 지도를 육지 쪽으로 옮겨 다시 시도하세요." };
  const [state] = await sql<{ collected: boolean; mine: number; enabled: number }[]>`
    select exists (select 1 from collect_targets where sgg_cd = ${r.sgg} and enabled) as collected,
      (select count(*)::int from region_requests where user_id = ${userId} and created_at > now() - interval '1 day') as mine,
      (select count(*)::int from collect_targets where enabled) as enabled`;
  if (state.collected) return { ok: true, status: "already", message: `${r.name}은(는) 이미 모으고 있어요. 지도를 조금 옮기거나 기간을 늘려 보세요.` };
  if (state.mine >= REGION_REQUESTS_PER_DAY) return { ok: false, message: `지역 요청은 하루 ${REGION_REQUESTS_PER_DAY}곳까지 할 수 있어요. 내일 다시 시도해 주세요.` };
  const status = state.enabled < env.regionTargetCap ? "enabled" : "pending";
  await sql.begin(async (tx) => {
    await tx`insert into regions (lawd_cd, sido, sigungu, level) values (${`${r.sgg}00000`}, ${r.sido || null}, ${r.sigungu || null}, 2)
             on conflict (lawd_cd) do nothing`;
    if (status === "enabled") {
      await tx`insert into collect_targets (sgg_cd, name) values (${r.sgg}, ${r.name || null})
               on conflict (sgg_cd) do update set enabled = true, name = coalesce(collect_targets.name, excluded.name)`;
    }
    await tx`insert into region_requests (user_id, sgg_cd, name, status) values (${userId}, ${r.sgg}, ${r.name || null}, ${status})`;
  });
  return status === "enabled"
    ? { ok: true, status, message: `${r.name} 실거래를 모으기 시작합니다. 다음 매일 수집(보통 다음 날 아침) 뒤 지도에 나타나요.` }
    : { ok: true, status, message: `요청을 남겼어요. 지금은 수집 지역이 많아 운영자가 확인한 뒤 ${r.name}을(를) 켭니다.` };
}
