import "server-only";
import { sql } from "./db";
import { env } from "./env";
import { countCall, QuotaExceededError } from "./external/building";
import { vworldEmdBoundaries, vworldGeocode } from "./external/vworld";
import { aggregateLive } from "./live-aggregate";
import type { DealKind, MapPoint } from "./map-filters";
import { type LiveTrade, normalizeLive, parseRtmsXml, RTMS_SERVICES, recentMonths, type RtmsSvc } from "./rtms-parse";

/*
 * 수집 전 지역 지도 미리보기. 아직 매일 수집 대상이 아닌 시군구로 지도를 옮기면 "모으지 않은 지역" 안내 대신
 * 국토부 실거래 API 를 바로 불러 최근 3개월 거래를 동네(읍면동)별로 보여 주고, 동네 수준으로 확대하면 단지별로 보여 준다.
 *
 * 부하를 늘리지 않게:
 *  - 받은 결과는 DB(live_trade_cache)에 24시간(지난달 이전은 7일) 두고 여러 사용자·서버 인스턴스가 같이 쓴다.
 *    시군구 하나 · 유형 하나면 서비스(매매·전월세) × 3개월 = 3~6번 호출.
 *  - 하루 호출 상한(LIVE_PREVIEW_DAILY_CALLS)을 따로 두고, 매일 수집과 같은 서비스 일일 한도(api_quota)에도 함께 센다.
 *  - 동네 중심은 브이월드 읍면동 경계를 시군구마다 한 번 받아 regions 에 넣는다(다음부터 DB).
 *  - 단지 위치는 실거래에 좌표가 없어 지번으로 찾는다. 화면 안 동네의 단지만, 요청마다 최대 25곳, 찾은 위치는 계속 쓴다(live_complex_geo).
 * DB 의 transactions 에는 넣지 않는다(저장·단지 매칭은 매일 수집이 같은 원천으로 한다).
 */

const BASE = "https://apis.data.go.kr/1613000";
export const LIVE_MONTHS = 3;
const GEOCODE_PER_REQUEST = 25;
/** 이 폭(경도) 이하로 확대하면 단지별로 */
export const LIVE_DETAIL_SPAN = 0.03;

export class LiveLimitError extends Error {}

async function fetchMonth(svc: RtmsSvc, sgg: string, ym: string): Promise<LiveTrade[]> {
  const [hit] = await sql<{ rows: LiveTrade[] }[]>`
    select rows from live_trade_cache
    where sgg_cd = ${sgg} and svc = ${svc.path} and ym = ${ym}
      and fetched_at > now() - (case when ${ym} >= to_char(current_date - interval '1 month', 'YYYYMM') then interval '24 hours' else interval '7 days' end)`;
  if (hit) return hit.rows;
  const rows: LiveTrade[] = [];
  for (let page = 1; page <= 3; page++) {
    // 미리보기 전용 상한 + 매일 수집과 같은 서비스 일일 한도
    await countCall("live-preview:rtms", env.livePreviewCalls).catch((e) => {
      throw new LiveLimitError(e instanceof Error ? e.message : String(e));
    });
    await countCall(`data.go.kr:${svc.path.split("/")[0]}`, env.quotaDataGoKr).catch((e) => {
      throw new LiveLimitError(e instanceof Error ? e.message : String(e));
    });
    const q = new URLSearchParams({ serviceKey: env.dataGoKrKey!, LAWD_CD: sgg, DEAL_YMD: ym, pageNo: String(page), numOfRows: "1000" });
    const res = await fetch(`${BASE}/${svc.path}?${q}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const { items, total } = parseRtmsXml(await res.text());
    for (const it of items) {
      const r = normalizeLive(it, svc);
      if (r && !r.canceled) rows.push(r);
    }
    if (page * 1000 >= total || !items.length) break;
  }
  await sql`
    insert into live_trade_cache (sgg_cd, svc, ym, rows, fetched_at) values (${sgg}, ${svc.path}, ${ym}, ${sql.json(rows)}, now())
    on conflict (sgg_cd, svc, ym) do update set rows = excluded.rows, fetched_at = now()`;
  return rows;
}

/** 시군구 최근 LIVE_MONTHS 개월 거래(이 유형). 한 달 실패는 건너뛰고, 상한에 걸리면 그때까지 받은 것만 */
export async function liveSggTrades(type: string, sgg: string, kind: DealKind): Promise<{ rows: LiveTrade[]; limited: boolean }> {
  const svcs = (RTMS_SERVICES[type] ?? []).filter((s) => (kind === "sale" ? s.kind === "sale" : s.kind === "rent"));
  const out: LiveTrade[] = [];
  let limited = false;
  for (const svc of svcs) {
    for (const ym of recentMonths(LIVE_MONTHS)) {
      try {
        out.push(...(await fetchMonth(svc, sgg, ym)));
      } catch (e) {
        if (e instanceof LiveLimitError) {
          limited = true;
          break;
        }
        console.warn("[live]", svc.path, sgg, ym, e instanceof Error ? e.message : e);
      }
    }
  }
  return { rows: out.filter((t) => t.kind === kind), limited };
}

/** 시군구 읍면동 중심. 거래에 나온 동네가 regions 에 없으면 브이월드 경계를 시군구 단위로 한 번 받아 넣는다(7일에 한 번까지) */
async function emdCenters(sgg: string, needed: Set<string>): Promise<{ lawd: string; emd: string; lng: number; lat: number }[]> {
  const read = () => sql<{ lawd: string; emd: string; lng: number; lat: number }[]>`
    select lawd_cd as lawd, emd, ST_X(center) as lng, ST_Y(center) as lat from regions
    where substr(lawd_cd, 1, 5) = ${sgg} and level = 3 and emd is not null and center is not null`;
  let rows = await read();
  const have = new Set(rows.map((r) => r.emd));
  if ([...needed].every((e) => have.has(e))) return rows;
  const [tried] = await sql`select 1 from poi_fetches where key = ${`emd:${sgg}`} and fetched_at > now() - interval '7 days'`;
  if (tried) return rows;
  await sql`insert into poi_fetches (key, fetched_at, count) values (${`emd:${sgg}`}, now(), 0)
            on conflict (key) do update set fetched_at = now()`;
  const feats = await vworldEmdBoundaries(sgg).catch((e) => {
    console.warn("[live] emd", sgg, e instanceof Error ? e.message : e);
    return [];
  });
  for (const f of feats) {
    const parts = f.fullName.split(" ");
    const g = JSON.stringify(f.geometry);
    await sql`
      insert into regions (lawd_cd, sido, sigungu, emd, level, geom, center)
      values (${f.code}, ${parts[0] ?? null}, ${parts.slice(1, -1).join(" ") || null}, ${f.name}, 3,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${g}), 4326)), 3)),
        ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(${g}), 4326)))
      on conflict (lawd_cd) do update set emd = coalesce(regions.emd, excluded.emd), geom = coalesce(regions.geom, excluded.geom),
        center = coalesce(regions.center, excluded.center)`;
  }
  rows = await read();
  return rows;
}

const geoKey = (sgg: string, t: LiveTrade) => `${sgg}|${t.umd}|${t.jibun}|${t.name}`;

/**
 * 미리보기 점. 넓게 보면 읍면동별, LIVE_DETAIL_SPAN 이하로 확대했고 단지형(아파트·오피스텔·빌라)이면 단지별.
 * pending: 아직 위치를 못 찾은 단지 수(다시 부르면 이어서 찾는다)
 */
export async function livePoints(opts: {
  sgg: string;
  regionName: string;
  type: string;
  kind: DealKind;
  bbox: [number, number, number, number];
}): Promise<{ points: MapPoint[]; level: "emd" | "complex"; limited: boolean; pending: number; total: number }> {
  const { sgg, type, kind, bbox } = opts;
  const { rows, limited } = await liveSggTrades(type, sgg, kind);
  const [w, s, e, n] = bbox;
  const inBox = (lng: number, lat: number, pad = 0) => lng >= w - pad && lng <= e + pad && lat >= s - pad && lat <= n + pad;
  const byEmd = new Map<string, LiveTrade[]>();
  for (const t of rows) {
    const k = t.umd.split(" ").pop() ?? t.umd;
    byEmd.set(k, [...(byEmd.get(k) ?? []), t]);
  }
  const centers = await emdCenters(sgg, new Set(byEmd.keys()));
  const complexType = ["apt", "officetel", "rowhouse"].includes(type);
  if (!complexType || e - w > LIVE_DETAIL_SPAN) {
    const points = centers
      .filter((c) => byEmd.has(c.emd) && inBox(c.lng, c.lat, (e - w) * 0.1))
      .map((c) => aggregateLive(`L${c.lawd}`, "region", c.emd, c.lng, c.lat, byEmd.get(c.emd)!));
    return { points, level: "emd", limited, pending: 0, total: rows.length };
  }
  // 단지별: 화면 안(조금 넓게)에 중심이 있는 동네의 거래만
  const near = new Set(centers.filter((c) => inBox(c.lng, c.lat, LIVE_DETAIL_SPAN)).map((c) => c.emd));
  const groups = new Map<string, LiveTrade[]>();
  for (const t of rows) {
    const emd = t.umd.split(" ").pop() ?? t.umd;
    if (!t.jibun || !t.name || (near.size && !near.has(emd))) continue;
    const k = geoKey(sgg, t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const keys = [...groups.keys()];
  const known = keys.length
    ? await sql<{ key: string; lng: number | null; lat: number | null; stale: boolean }[]>`
        select key, ST_X(geom) as lng, ST_Y(geom) as lat, (geom is null and tried_at < now() - interval '30 days') as stale
        from live_complex_geo where key in ${sql(keys)}`
    : [];
  const pos = new Map(known.map((k) => [k.key, k]));
  // 화면 가운데에 가까운 동네, 그 안에서 거래 많은 단지부터 위치 찾기
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const emdDist = new Map(centers.map((c) => [c.emd, Math.hypot(c.lng - cx, c.lat - cy)]));
  const distOf = (k: string) => emdDist.get(groups.get(k)![0].umd.split(" ").pop() ?? "") ?? 1;
  const todo = keys
    .filter((k) => !pos.has(k) || pos.get(k)!.stale)
    .sort((a, b) => distOf(a) - distOf(b) || groups.get(b)!.length - groups.get(a)!.length);
  let found = 0;
  for (const k of todo.slice(0, GEOCODE_PER_REQUEST)) {
    const t = groups.get(k)![0];
    let pt: [number, number] | null = null;
    try {
      await countCall("live-preview:geocode", env.livePreviewGeocodes);
      pt = await vworldGeocode(`${opts.regionName} ${t.umd} ${t.jibun}`, "PARCEL");
    } catch (err) {
      if (err instanceof QuotaExceededError) break;
      continue; // 키·일시 오류는 기억하지 않는다
    }
    await sql`
      insert into live_complex_geo (key, sgg_cd, umd_nm, jibun, name, geom, tried_at)
      values (${k}, ${sgg}, ${t.umd}, ${t.jibun}, ${t.name}, ${pt ? sql`ST_SetSRID(ST_MakePoint(${pt[0]}, ${pt[1]}), 4326)` : null}, now())
      on conflict (key) do update set geom = excluded.geom, tried_at = now()`;
    pos.set(k, { key: k, lng: pt?.[0] ?? null, lat: pt?.[1] ?? null, stale: false });
    found++;
  }
  const points: MapPoint[] = [];
  for (const [k, ts] of groups) {
    const p = pos.get(k);
    if (p?.lng == null || p.lat == null || !inBox(p.lng, p.lat)) continue;
    points.push(aggregateLive(`L${k}`, "complex", ts[0].name, p.lng, p.lat, ts));
  }
  const pending = Math.max(0, todo.length - found);
  return { points: points.sort((a, b) => b.n - a.n).slice(0, 300), level: "complex", limited, pending, total: rows.length };
}
