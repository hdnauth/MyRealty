import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { geocode } from "@/lib/external/geocode";
import { type LiveTrade, liveTrades } from "@/lib/external/rtms";
import { median } from "@/lib/queries/items";
import { isPropertyType, PROPERTY_TYPES } from "@/lib/property";

export type PreviewTrade = Pick<LiveTrade, "kind" | "date" | "price" | "rent" | "area" | "floor" | "canceled"> & { name: string | null };
export type TradePreview = {
  /** db: 이미 수집된 거래 · live: 실거래 API 에서 바로 조회(저장 전) · none: 조회 불가 */
  source: "db" | "live" | "none";
  /** 비교 기준 설명(같은 단지 / 같은 동네·비슷한 면적 등) */
  basis: string;
  sales12m: number;
  /** 평형별(단지형) 최근 1년 매매 중위·전세 중위 */
  byArea: { area: number; sales: number; median: number | null; jeonseMedian: number | null }[];
  /** ㎡당 매매 중위(만원, 단지가 없는 유형) */
  unitMedian: number | null;
  recent: PreviewTrade[];
  point: [number, number] | null;
  note: string | null;
};

const lastToken = (s: string | null) => (s ?? "").trim().split(/\s+/).at(-1) ?? "";

/** 평형(±0.5㎡)별 매매·전세 요약 */
function summarizeByArea(rows: PreviewTrade[]) {
  const groups: { area: number; rows: PreviewTrade[] }[] = [];
  for (const r of [...rows].filter((x) => x.area).sort((a, b) => a.area! - b.area!)) {
    const g = groups.at(-1);
    if (g && r.area! - g.area <= 0.5) g.rows.push(r);
    else groups.push({ area: r.area!, rows: [r] });
  }
  return groups.map((g) => {
    const sales = g.rows.filter((r) => r.kind === "sale" && !r.canceled);
    return {
      area: g.area,
      sales: sales.length,
      median: median(sales.map((r) => r.price)),
      jeonseMedian: median(g.rows.filter((r) => r.kind === "jeonse").map((r) => r.price)),
    };
  });
}

/**
 * 등록 화면 미리보기: 고른 주소의 최근 실거래(단지형은 같은 단지, 그 외는 같은 동네의 비슷한 거래)와 좌표.
 * 수집된 단지면 DB, 아니면 실거래 API 를 바로 조회한다(저장은 등록 후 개별 수집이 한다).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "";
  const sgg = sp.get("sgg") ?? "";
  if (!isPropertyType(type) || !/^\d{5}$/.test(sgg)) return NextResponse.json({ error: "type/sgg" }, { status: 400 });
  const umd = lastToken(sp.get("umd"));
  const jibun = (sp.get("jibun") ?? "").replace(/^산\s*/, "");
  const complexId = Number(sp.get("complexId")) || null;
  const area = Number(sp.get("area")) || null;
  const jimok = sp.get("jimok") || null;
  const addr = sp.get("addr") ?? "";
  const tx = PROPERTY_TYPES[type].tx;
  const hasComplex = PROPERTY_TYPES[type].hasComplex;
  const isLand = tx === "land";

  // 좌표: 수집된 단지 → 주소 지오코딩 → 읍면동 중심
  const pointP = (async (): Promise<[number, number] | null> => {
    if (complexId) {
      const [c] = await sql<{ lng: number | null; lat: number | null }[]>`select ST_X(geom) as lng, ST_Y(geom) as lat from complexes where id = ${complexId}`;
      if (c?.lng != null && c.lat != null) return [c.lng, c.lat];
    }
    const g = addr ? await geocode(addr).catch(() => null) : null;
    if (g) return g;
    const lawd = sp.get("lawd");
    if (!lawd) return null;
    const [r] = await sql<{ lng: number | null; lat: number | null }[]>`select ST_X(center) as lng, ST_Y(center) as lat from regions where lawd_cd = ${lawd}`;
    return r?.lng != null && r.lat != null ? [r.lng, r.lat] : null;
  })();
  let source: TradePreview["source"] = "none";
  let rows: PreviewTrade[] = [];
  let note: string | null = null;
  let basis = hasComplex ? "같은 단지" : `같은 동네(${umd || "읍면동"})`;

  // 비슷한 거래(단지가 없는 유형): 같은 읍면동, 면적 건물 ±40%·토지 1/5~5배(상세 화면 similarCriteria 와 같은 기준 —
  // 토지는 ㎡당 가격으로 비교하고 필지 크기 편차가 커서 넓게), 임야는 지목 임야, 토지는 같은 지목 우선
  const [lo, hi] = area ? (isLand ? [area / 5, area * 5] : [area * 0.6, area * 1.4]) : [0, Infinity];
  const similarArea = (a: number | null) => !area || (a !== null && a >= lo && a <= hi);
  if (!hasComplex) {
    basis += `${area ? ` · 면적 ${Math.round(lo).toLocaleString()}~${Math.round(hi).toLocaleString()}㎡` : ""}${type === "forest" ? " · 임야" : jimok && isLand ? ` · ${jimok}` : ""}`;
  }

  if (complexId) {
    rows = await sql<PreviewTrade[]>`
      select deal_kind as kind, deal_date::text as date, price, monthly_rent as rent, area_m2::float8 as area, floor, is_canceled as canceled, name
      from transactions where complex_id = ${complexId}
        and deal_date >= current_date - case when deal_kind = 'sale' then 365 else 183 end
      order by deal_date desc limit 400`;
    if (rows.length) source = "db";
  } else if (!hasComplex && umd) {
    rows = await sql<PreviewTrade[]>`
      select deal_kind as kind, deal_date::text as date, price, monthly_rent as rent,
        coalesce(area_m2, land_area_m2)::float8 as area, floor, is_canceled as canceled, name
      from transactions
      where sgg_cd = ${sgg} and property_type = ${tx} and deal_kind = 'sale' and umd_nm = ${umd}
        and deal_date >= current_date - 365
        and (${type !== "forest"} or jimok = '임야') and (${!(isLand && jimok && type !== "forest")} or jimok = ${jimok})
      order by deal_date desc limit 400`;
    rows = rows.filter((r) => similarArea(r.area));
    if (rows.length) source = "db";
  }

  if (source === "none" && env.dataGoKrKey && (hasComplex ? umd && jibun : umd)) {
    try {
      const filter = hasComplex
        ? (t: LiveTrade) => t.umd === umd && t.jibun === jibun
        : (t: LiveTrade) =>
            t.umd === umd &&
            similarArea(t.area) &&
            (type !== "forest" || t.jimok === "임야") &&
            (!(isLand && jimok && type !== "forest") || t.jimok === jimok);
      const r = await liveTrades(tx, sgg, filter, { saleMonths: 12, rentMonths: hasComplex ? 6 : 0 });
      rows = r.rows.map((t) => ({ kind: t.kind, date: t.date, price: t.price, rent: t.rent, area: t.area, floor: t.floor, canceled: t.canceled, name: t.name || null }));
      source = "live";
      if (r.failed) note = `일부 달(${r.failed}건)은 조회하지 못했습니다.`;
    } catch (e) {
      note = `실거래 조회 실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else if (source === "none" && !env.dataGoKrKey) {
    note = "DATA_GO_KR_KEY 가 없어 실거래를 바로 조회하지 못했습니다.";
  }

  const sales = rows.filter((r) => r.kind === "sale" && !r.canceled);
  const body: TradePreview = {
    source,
    basis,
    sales12m: sales.length,
    byArea: hasComplex ? summarizeByArea(rows) : [],
    unitMedian: hasComplex ? null : median(sales.filter((r) => r.area).map((r) => r.price / r.area!)),
    recent: rows.slice(0, 60),
    point: await pointP,
    note,
  };
  return NextResponse.json(body);
}
