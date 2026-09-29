import "server-only";
import { sql } from "../db";
import { env } from "../env";
import { aggregateUnits, type UnitInfo, type UnitTuple } from "../units";

export type { UnitInfo };

/*
 * 국토교통부 건축HUB 건축물대장정보 서비스(apis.data.go.kr/1613000/BldRgstHubService).
 * 부동산 등록 화면에서 주소를 고르면 표제부(용도·세대수·사용승인일)와 전유공용면적(동·호·층·전용면적)을 조회해
 * 유형 판별·평형 목록·동/호 선택에 쓴다. 표제부는 ETL 과 같은 형태로 building_registers 에 저장해 함께 쓴다.
 */

const BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";

export class QuotaExceededError extends Error {}

/** api_quota 에 호출 1회 기록(ETL 과 같은 이름·한도). 한도를 넘으면 예외 */
export async function countCall(api: string, limit?: number) {
  const [row] = await sql<{ calls: number }[]>`
    insert into api_quota (api, day, calls) values (${api}, current_date, 1)
    on conflict (api, day) do update set calls = api_quota.calls + 1 returning calls`;
  if (limit !== undefined && row.calls > limit) throw new QuotaExceededError(`${api} 일일 호출 한도(${limit}) 초과`);
}

type Raw = Record<string, unknown>;

function lotParams(pnu: string) {
  return {
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    platGbCd: pnu[10] === "2" ? "1" : "0",
    bun: pnu.slice(11, 15),
    ji: pnu.slice(15, 19),
  };
}

async function call(op: string, pnu: string, page: number, rows: number): Promise<{ items: Raw[]; total: number }> {
  if (!env.dataGoKrKey) throw new Error("DATA_GO_KR_KEY 미설정");
  await countCall(`data.go.kr:BldRgstHubService:${op}`, env.quotaDataGoKr);
  const params = new URLSearchParams({
    serviceKey: env.dataGoKrKey,
    ...lotParams(pnu),
    _type: "json",
    numOfRows: String(rows),
    pageNo: String(page),
  });
  const res = await fetch(`${BASE}/${op}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let data: Raw;
  try {
    data = JSON.parse(text);
  } catch {
    // 인증키 오류 등은 XML 로 온다
    const msg = text.match(/<returnAuthMsg>([^<]+)</)?.[1] ?? text.match(/<resultMsg>([^<]+)</)?.[1] ?? `HTTP ${res.status}`;
    throw new Error(`건축HUB ${msg}`);
  }
  const response = (data.response ?? {}) as Raw;
  const header = (response.header ?? {}) as Raw;
  const code = String(header.resultCode ?? "00");
  if (code !== "00" && code !== "000") throw new Error(`건축HUB 오류 ${code}: ${String(header.resultMsg ?? "")}`);
  const body = (response.body ?? {}) as Raw;
  const itemsBlock = body.items;
  const item = itemsBlock && typeof itemsBlock === "object" ? (itemsBlock as Raw).item : null;
  const items = item == null ? [] : Array.isArray(item) ? (item as Raw[]) : [item as Raw];
  return { items, total: Number(body.totalCount ?? items.length) || 0 };
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const n = (v: unknown) => {
  const x = Number(s(v).replace(/,/g, ""));
  return s(v) !== "" && Number.isFinite(x) ? x : null;
};

/** 표제부 1건(ETL parse_title 과 같은 키 + etc_purpose) */
export type TitleRow = {
  bld_nm: string | null;
  dong_nm: string | null;
  main_purpose: string | null;
  etc_purpose?: string | null;
  approved_at: string | null;
  floors_above: number | null;
  households: number | null;
  units: number | null;
  total_area: number | null;
  plat_area: number | null;
  vl_rat: number | null;
  floors_below?: number | null;
  structure?: string | null;
  bc_rat?: number | null;
  elevators?: number | null;
  parking?: number | null;
};
export type RecapRow = {
  bld_nm: string | null;
  households: number | null;
  main_buildings: number | null;
  total_area: number | null;
  plat_area: number | null;
  bc_rat?: number | null;
  vl_rat?: number | null;
  parking?: number | null;
};

function parseTitle(it: Raw): TitleRow {
  const apr = s(it.useAprDay);
  return {
    bld_nm: s(it.bldNm) || null,
    dong_nm: s(it.dongNm) || null,
    main_purpose: s(it.mainPurpsCdNm) || null,
    etc_purpose: s(it.etcPurps) || null,
    approved_at: apr.length === 8 ? `${apr.slice(0, 4)}-${apr.slice(4, 6)}-${apr.slice(6, 8)}` : null,
    floors_above: n(it.grndFlrCnt),
    households: n(it.hhldCnt),
    units: n(it.hoCnt),
    total_area: n(it.totArea),
    plat_area: n(it.platArea),
    vl_rat: n(it.vlRat),
    // ETL(collectors/building.py parse_title)과 같은 필드 — 같은 테이블을 둘이 쓰므로 한쪽이 먼저 저장해도 화면이 비지 않게
    floors_below: n(it.ugrndFlrCnt),
    structure: s(it.strctCdNm) || null,
    bc_rat: n(it.bcRat),
    elevators: n(it.rideUseElvtCnt),
    parking: (n(it.indrAutoUtcnt) ?? 0) + (n(it.oudrAutoUtcnt) ?? 0) || null,
  };
}

/** 표제부·총괄표제부. 30일 안에 받은 게 있으면 DB 값을 쓴다 */
export async function getTitles(pnu: string): Promise<{ titles: TitleRow[]; recap: RecapRow | null }> {
  const [hit] = await sql<{ titles: TitleRow[]; recap: RecapRow | null }[]>`
    select titles, recap from building_registers where pnu = ${pnu}
      and fetched_at > now() - case when jsonb_array_length(titles) > 0 then interval '30 days' else interval '1 day' end`;
  if (hit) return hit;
  const [t, r] = await Promise.all([call("getBrTitleInfo", pnu, 1, 100), call("getBrRecapTitleInfo", pnu, 1, 10)]);
  const titles = t.items.map(parseTitle);
  const ri = r.items[0];
  const recap: RecapRow | null = ri
    ? {
        bld_nm: s(ri.bldNm) || null,
        households: n(ri.hhldCnt),
        main_buildings: n(ri.mainBldCnt),
        total_area: n(ri.totArea),
        plat_area: n(ri.platArea),
        bc_rat: n(ri.bcRat),
        vl_rat: n(ri.vlRat),
        parking: n(ri.totPkngCnt),
      }
    : null;
  await sql`insert into building_registers (pnu, titles, recap, fetched_at) values (${pnu}, ${sql.json(titles)}, ${recap ? sql.json(recap) : null}, now())
            on conflict (pnu) do update set titles = excluded.titles, recap = excluded.recap, fetched_at = now()`;
  return { titles, recap };
}

const unitCache = new Map<string, { at: number; data: { units: UnitInfo[]; partial: boolean } }>();
const UNIT_TTL = 6 * 3600_000;
const PAGE_ROWS = 1000;
const MAX_PAGES = 8;

/**
 * 필지의 전 호(동·호·층·전용면적). 대단지는 페이지가 많아 MAX_PAGES 까지만 받는다(partial).
 * 등록 중에만 필요해 DB 에 저장하지 않고 서버 메모리에 잠깐 둔다.
 */
export async function getUnits(pnu: string): Promise<{ units: UnitInfo[]; partial: boolean }> {
  const hit = unitCache.get(pnu);
  if (hit && Date.now() - hit.at < UNIT_TTL) return hit.data;
  const first = await call("getBrExposPubuseAreaInfo", pnu, 1, PAGE_ROWS);
  const rows = [...first.items];
  // 서비스가 요청보다 적게 주면(한 페이지 상한) 그 크기로 이어 받는다
  const size = first.items.length > 0 && first.items.length < PAGE_ROWS ? first.items.length : PAGE_ROWS;
  const pages = Math.min(MAX_PAGES, Math.ceil(first.total / size));
  for (let p = 2; p <= pages; p += 3) {
    const batch = await Promise.all(
      [p, p + 1, p + 2].filter((x) => x <= pages).map((x) => call("getBrExposPubuseAreaInfo", pnu, x, size)),
    );
    for (const b of batch) rows.push(...b.items);
  }
  const data = { units: aggregateUnits(rows), partial: rows.length < first.total };
  if (unitCache.size > 50) unitCache.delete(unitCache.keys().next().value!);
  unitCache.set(pnu, { at: Date.now(), data });
  return data;
}

export function toTuples(units: UnitInfo[]): UnitTuple[] {
  return units.map((u) => [u.dong, u.ho, u.floor, u.area]);
}
