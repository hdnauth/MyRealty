// 부동산 상세 개요용 계산 (서버·클라이언트 공용 순수 함수, 금액 단위 만원)

import { monthlyPayment } from "./finance";

type Deal = { deal_kind: string; deal_date: string; price: number; floor: number | null; is_canceled: boolean };

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const DAY = 86_400_000;
const t = (d: string) => new Date(d).getTime();

export type FloorBand = { key: "low" | "mid" | "high"; label: string; range: string; n: number; premium: number | null };

/**
 * 층별 가격 차이. 시점 차이를 없애려고 각 거래를 앞뒤 90일 같은 단지·면적 거래 중위가로 나눈 비율을 쓴다.
 * 저층 = 전체 최고층의 25% 이하(최소 3층까지), 고층 = 75% 이상. premium 은 전체 대비 ±비율.
 */
export function floorPremiums(points: Deal[], opts: { now?: Date; months?: number } = {}): { bands: FloorBand[]; maxFloor: number } | null {
  const now = (opts.now ?? new Date()).getTime();
  const since = now - (opts.months ?? 36) * 30.44 * DAY;
  const sales = points.filter((p) => p.deal_kind === "sale" && !p.is_canceled && p.price && p.floor != null && p.floor > 0 && t(p.deal_date) >= since);
  if (sales.length < 8) return null;
  const maxFloor = Math.max(...sales.map((p) => p.floor!));
  if (maxFloor < 4) return null;
  const lowTop = Math.max(3, Math.round(maxFloor * 0.25));
  const highBottom = Math.max(lowTop + 1, Math.round(maxFloor * 0.75));
  const ratios: { floor: number; r: number }[] = [];
  for (const p of sales) {
    const around = sales.filter((q) => Math.abs(t(q.deal_date) - t(p.deal_date)) <= 90 * DAY).map((q) => q.price);
    if (around.length < 3) continue;
    ratios.push({ floor: p.floor!, r: p.price / median(around)! });
  }
  if (ratios.length < 8) return null;
  const all = median(ratios.map((x) => x.r))!;
  const band = (key: FloorBand["key"], label: string, lo: number, hi: number): FloorBand => {
    const rs = ratios.filter((x) => x.floor >= lo && x.floor <= hi).map((x) => x.r);
    const m = median(rs);
    return { key, label, range: lo === hi ? `${lo}층` : `${lo}~${hi}층`, n: rs.length, premium: m !== null && rs.length >= 3 ? m / all - 1 : null };
  };
  return {
    maxFloor,
    bands: [band("low", "저층", 1, lowTop), band("mid", "중층", lowTop + 1, highBottom - 1), band("high", "고층", highBottom, maxFloor)],
  };
}

export function floorBandOf(floor: number | null, bands: FloorBand[]): FloorBand | null {
  if (floor == null) return null;
  return (
    bands.find((b) => {
      const [lo, hi] = b.range.replace(/층/g, "").split("~").map(Number);
      return floor >= lo && floor <= (hi ?? lo);
    }) ?? null
  );
}

/** 금리 민감도: 기준 금리에서 ±0.5%p, ±1%p 일 때 월 상환액 */
export function rateSensitivity(principal: number, rate: number, years: number, deltas = [-1, -0.5, 0, 0.5, 1]) {
  const base = monthlyPayment(principal, rate, years);
  return deltas
    .filter((d) => rate + d > 0)
    .map((d) => {
      const m = monthlyPayment(principal, rate + d, years);
      return { delta: d, rate: rate + d, monthly: m, diff: m - base, annualDiff: (m - base) * 12 };
    });
}

/**
 * 전세 보증금 점검.
 * - 임대인: 지금 전세 시세로 새 세입자를 받으면 돌려줄 보증금이 얼마나 모자라는지(역전세)
 * - 임차인: 보증금이 매매 시세의 몇 %인지(깡통전세 위험은 jeonseRisk 와 함께 본다)
 * 전세 시세 흐름은 최근 6개월 중위 vs 21~27개월 전(2년 전 계약 시점) 중위.
 */
export function jeonseCheck(p: { deposit: number | null; role: "landlord" | "tenant" | null; points: Deal[]; now?: Date }) {
  const now = (p.now ?? new Date()).getTime();
  const jeonse = p.points.filter((x) => x.deal_kind === "jeonse" && !x.is_canceled && x.price);
  const within = (fromM: number, toM: number) =>
    jeonse.filter((x) => {
      const age = (now - t(x.deal_date)) / (30.44 * DAY);
      return age >= fromM && age < toM;
    }).map((x) => x.price);
  const current = median(within(0, 6));
  const twoYearsAgo = median(within(21, 27));
  const trend = current && twoYearsAgo ? current / twoYearsAgo - 1 : null;
  const gap = p.deposit && current ? current - p.deposit : null; // 음수면 시세가 보증금보다 낮음
  let level: "양호" | "주의" | "위험" | "판단불가" = "판단불가";
  if (gap !== null && p.deposit) {
    const r = gap / p.deposit;
    level = r >= -0.03 ? "양호" : r >= -0.1 ? "주의" : "위험";
  }
  return { current, twoYearsAgo, trend, gap, level, samples: within(0, 6).length };
}

// ───────── 가격 추이 겹쳐 보기 · 상대 가격 위치 ─────────

export type MonthPoint = [string, number];

/**
 * 거래(날짜·값) → 월별 이동 중위(기본 3개월). 창 안 거래가 minN 미만인 달은 비운다.
 * 결과 날짜는 그 달 1일(YYYY-MM-01).
 */
export function monthlyRollingMedian(deals: { date: string; value: number }[], opts: { window?: number; minN?: number } = {}): MonthPoint[] {
  const window = opts.window ?? 3;
  const minN = opts.minN ?? 2;
  if (!deals.length) return [];
  const byMonth = new Map<string, number[]>();
  for (const d of deals) {
    const k = `${d.date.slice(0, 7)}-01`;
    byMonth.set(k, [...(byMonth.get(k) ?? []), d.value]);
  }
  const months = [...byMonth.keys()].sort();
  const start = new Date(`${months[0]}T00:00:00Z`);
  const end = new Date(`${months.at(-1)}T00:00:00Z`);
  const all: string[] = [];
  for (const m = new Date(start); m <= end; m.setUTCMonth(m.getUTCMonth() + 1)) all.push(m.toISOString().slice(0, 10));
  const out: MonthPoint[] = [];
  all.forEach((m, i) => {
    const vals = all.slice(Math.max(0, i - window + 1), i + 1).flatMap((k) => byMonth.get(k) ?? []);
    if (vals.length >= minN) out.push([m, median(vals)!]);
  });
  return out;
}

/** 첫 공통 달을 100으로 맞춘 지수(상대 성과 비교용) */
export function rebase(series: MonthPoint[][]): MonthPoint[][] {
  const firsts = series.map((s) => s[0]?.[0]).filter(Boolean) as string[];
  if (!firsts.length) return series.map(() => []);
  const from = firsts.sort().at(-1)!;
  return series.map((s) => {
    const base = s.find(([d]) => d >= from)?.[1];
    return base ? s.filter(([d]) => d >= from).map(([d, v]) => [d, (v / base) * 100] as MonthPoint) : [];
  });
}

/**
 * 상대 가격 위치: 내 단지 ÷ 유사 단지군 단위면적 가격 비율의 로그 격차를 월별로 보고,
 * 최근 값이 과거(최근 36개월) 평균에서 몇 표준편차 떨어졌는지(z).
 * z ≤ −1: 평소보다 싸게 거래(상대 저평가 후보), z ≥ 1: 평소보다 비싸게.
 */
export function relativeValue(self: MonthPoint[], comps: MonthPoint[]) {
  const c = new Map(comps);
  const spread = self.filter(([d]) => c.has(d)).map(([d, v]) => [d, Math.log(v / c.get(d)!)] as MonthPoint);
  if (spread.length < 12) return null;
  const xs = spread.map(([, v]) => v);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  const now = xs.at(-1)!;
  const z = sd > 1e-9 ? (now - mean) / sd : 0;
  return {
    spread: spread.map(([d, v]) => [d, Math.exp(v) - 1] as MonthPoint), // 유사 단지 대비 ±비율
    current: Math.exp(now) - 1,
    average: Math.exp(mean) - 1,
    z,
    verdict: z <= -1 ? ("평소보다 싸게 거래" as const) : z >= 1 ? ("평소보다 비싸게 거래" as const) : ("평소 수준" as const),
  };
}
