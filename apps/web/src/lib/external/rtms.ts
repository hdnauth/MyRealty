import "server-only";
import { env } from "../env";
import { type LiveTrade, normalizeLive, parseRtmsXml, RTMS_SERVICES, type RtmsSvc, recentMonths } from "../rtms-parse";
import { countCall } from "./building";

export type { LiveTrade };

/*
 * 국토교통부 실거래가 API(apis.data.go.kr/1613000) 미리보기.
 * 부동산 등록 화면에서 아직 수집되지 않은 지역·단지의 최근 거래를 바로 보여 주는 용도라 DB 에 저장하지 않는다
 * (저장·단지 매칭은 ETL 이 같은 원천으로 한다: services/etl/src/myrealty_etl/collectors/rtms.py).
 */

const BASE = "https://apis.data.go.kr/1613000";

const cache = new Map<string, { at: number; rows: LiveTrade[] }>();
const TTL = 6 * 3600_000;

async function fetchMonth(svc: RtmsSvc, sgg: string, ym: string): Promise<LiveTrade[]> {
  const key = `${svc.path}|${sgg}|${ym}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;
  const rows: LiveTrade[] = [];
  for (let page = 1; page <= 3; page++) {
    // ETL 과 같은 이름으로 호출량을 센다(같은 일일 한도를 나눠 쓴다)
    await countCall(`data.go.kr:${svc.path.split("/")[0]}`, env.quotaDataGoKr);
    const q = new URLSearchParams({ serviceKey: env.dataGoKrKey!, LAWD_CD: sgg, DEAL_YMD: ym, pageNo: String(page), numOfRows: "1000" });
    const res = await fetch(`${BASE}/${svc.path}?${q}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const { items, total } = parseRtmsXml(await res.text());
    for (const it of items) {
      const r = normalizeLive(it, svc);
      if (r) rows.push(r);
    }
    if (page * 1000 >= total || !items.length) break;
  }
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

/** 동시 호출 수를 제한해 순서대로 */
async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (i < xs.length) {
        const k = i++;
        out[k] = await fn(xs[k]);
      }
    }),
  );
  return out;
}

/**
 * 시군구의 최근 거래를 받아 filter 에 맞는 것만. 매매는 saleMonths, 전월세는 rentMonths 개월.
 * 한 달·한 서비스 실패는 건너뛰고(부분 결과), 모두 실패하면 첫 오류를 던진다.
 */
export async function liveTrades(
  txType: keyof typeof RTMS_SERVICES,
  sgg: string,
  filter: (t: LiveTrade) => boolean,
  opts: { saleMonths?: number; rentMonths?: number } = {},
): Promise<{ rows: LiveTrade[]; failed: number }> {
  if (!env.dataGoKrKey) throw new Error("DATA_GO_KR_KEY 미설정");
  const jobs = (RTMS_SERVICES[txType] ?? []).flatMap((svc) =>
    recentMonths(svc.kind === "sale" ? (opts.saleMonths ?? 12) : (opts.rentMonths ?? 6)).map((ym) => ({ svc, ym })),
  );
  let firstError: unknown = null;
  let failed = 0;
  const parts = await pool(jobs, 6, async ({ svc, ym }) => {
    try {
      return (await fetchMonth(svc, sgg, ym)).filter(filter);
    } catch (e) {
      failed++;
      firstError ??= e;
      return [];
    }
  });
  if (failed === jobs.length && firstError) throw firstError;
  return { rows: parts.flat().sort((a, b) => b.date.localeCompare(a.date)), failed };
}
