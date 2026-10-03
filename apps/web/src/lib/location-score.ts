/**
 * 생활편의 점수(0~100) — ETL services/etl/src/myrealty_etl/analytics/location.py score_point 의 TypeScript 판.
 * 지도에서 화면 안 단지 점수를 즉석으로 계산할 때 쓴다(저장은 lib/queries/location-live.ts).
 *
 * 두 구현이 어긋나지 않도록 같은 입력·기대값 묶음(__tests__/fixtures/location-parity.json)을
 * 양쪽 테스트가 함께 확인한다. 공식·가중치를 바꾸면 Python 을 고친 뒤
 * `UPDATE_LOCATION_PARITY=1 uv run pytest tests/test_location_parity.py` 로 묶음을 다시 만들고 여기도 맞춘다.
 */
import type { LocCategory, LocDetail } from "./queries/location";

/** 지도·카드용 요약(GET /api/map/location) */
export type LocSummary = {
  total: number | null;
  /** full: 시설이 갖춰진 상태로 계산 · quick: 역·학교·공원·병원·마트와 직주근접만으로 낸 간이 점수 */
  basis: "full" | "quick";
  /** 항목별 점수(교통·직주근접·학교…, 미수집은 null) */
  cats: Record<string, number | null>;
};

export type ScorePoi = {
  source: string;
  source_id: string;
  category: string;
  subcategory: string | null;
  name: string | null;
  area_m2: number | null;
  line: string | null;
  /** 지점에서 거리(m) — 영역이 있으면 경계까지 */
  d: number;
  /** 반경 1km 원과 겹치는 면적(공원) */
  area_1km: number | null;
};

type Subs = null | string[] | { like?: readonly string[]; unlike?: readonly string[] };
type Comp =
  | ["near", string[], Subs, { good: number; bad: number; label?: string; sized?: boolean }, number]
  | ["count", string[], Subs, { r: number; k: number; label?: string }, number]
  | ["area", string[], Subs, { r: number; k: number }, number]
  | ["lines", string[], Subs, { walk: number }, number]
  | ["jobs", string[], Subs, Record<string, never>, number];

const SUPERMARKET = ["슈퍼", "supermarket"] as const;
const BIG_STORE_EXCLUDE = [...SUPERMARKET, "편의점"] as const;

export const SPECS: Record<string, [string, number, Comp[]]> = {
  transit: ["교통", 0.2, [
    ["near", ["subway"], null, { good: 250, bad: 1200 }, 0.55],
    ["lines", ["subway"], null, { walk: 1200 }, 0.15],
    ["count", ["bus"], null, { r: 500, k: 7 }, 0.3],
  ]],
  jobs: ["직주근접", 0.2, [["jobs", [], null, {}, 1.0]]],
  school: ["학교", 0.12, [
    ["near", ["school"], ["초등학교"], { good: 250, bad: 1000 }, 0.6],
    ["count", ["school"], ["중학교", "고등학교"], { r: 1000, k: 2.5 }, 0.4],
  ]],
  shopping: ["쇼핑", 0.1, [
    ["near", ["mart"], { unlike: BIG_STORE_EXCLUDE }, { good: 500, bad: 3000, label: "대형마트·백화점" }, 0.5],
    ["count", ["mart"], { like: SUPERMARKET }, { r: 500, k: 2, label: "슈퍼마켓" }, 0.25],
    ["count", ["convenience"], null, { r: 500, k: 6 }, 0.25],
  ]],
  park: ["공원", 0.12, [
    ["near", ["park"], null, { good: 300, bad: 1500, sized: true }, 0.7],
    ["area", ["park"], null, { r: 1000, k: 80_000 }, 0.3],
  ]],
  academy: ["학원", 0.1, [["count", ["academy"], null, { r: 1000, k: 90 }, 1.0]]],
  medical: ["의료", 0.08, [
    ["near", ["hospital"], ["상급종합", "상급종합병원", "종합병원"], { good: 1000, bad: 5000 }, 0.4],
    ["count", ["clinic"], { unlike: ["치과", "한의", "요양"] }, { r: 1000, k: 20, label: "의원" }, 0.4],
    ["count", ["clinic"], { like: ["치과", "한의"] }, { r: 1000, k: 12, label: "치과·한의원" }, 0.2],
  ]],
  food: ["음식·카페", 0.08, [["count", ["food", "cafe"], null, { r: 500, k: 100 }, 1.0]]],
};

/** (이름, 경도, 위도, 가중, 도심 여부) */
export const JOB_CENTERS: [string, number, number, number, boolean][] = [
  ["강남(GBD)", 127.0276, 37.4979, 1.0, true],
  ["광화문·시청(CBD)", 126.9769, 37.5714, 1.0, true],
  ["여의도(YBD)", 126.9246, 37.5219, 1.0, true],
  ["판교", 127.1112, 37.402, 0.9, false],
  ["마곡", 126.835, 37.56, 0.8, false],
  ["가산·구로디지털", 126.8826, 37.4816, 0.75, false],
  ["상암DMC", 126.8895, 37.5779, 0.75, false],
  ["성수", 127.056, 37.5446, 0.75, false],
  ["수원 영통(삼성)", 127.055, 37.256, 0.65, false],
  ["기흥·동탄(반도체)", 127.073, 37.211, 0.6, false],
  ["송도", 126.6566, 37.3925, 0.7, false],
  ["평택 고덕", 127.049, 37.024, 0.5, false],
  ["세종 정부청사", 127.259, 36.504, 0.65, true],
  ["대전 둔산", 127.3845, 36.351, 0.7, true],
  ["대구 도심", 128.595, 35.869, 0.75, true],
  ["부산 서면", 129.0592, 35.1578, 0.8, true],
  ["부산 센텀", 129.13, 35.169, 0.7, false],
  ["울산 삼산", 129.338, 35.539, 0.7, true],
  ["광주 상무", 126.851, 35.152, 0.7, true],
  ["창원 상남", 128.681, 35.223, 0.6, true],
];
const JOB_FREE_M = 1500;
const JOB_DECAY_M = 12_000;
const JOB_SECOND = 0.3;
const JOB_CORE_SHARE = 0.5;
const LINE_VALUE: Record<number, number> = { 1: 45, 2: 80 };

/** Python round(x, 1) 과 같은 자리(반올림 경계의 아주 작은 차이는 테스트에서 허용) */
const r1 = (x: number) => Math.round(x * 10) / 10;

export function linear(d: number, good: number, bad: number): number {
  if (d <= good) return 100;
  if (d >= bad) return 0;
  return (100 * (bad - d)) / (bad - good);
}

export function saturate(n: number, k: number): number {
  return k > 0 ? 100 * (1 - Math.exp(-Math.max(n, 0) / k)) : 0;
}

export function decayWeight(d: number, r: number): number {
  if (d <= r / 2) return 1;
  if (d >= r) return 0;
  return (2 * (r - d)) / r;
}

export function parkSizeFactor(area: number | null): number {
  if (area === null || area === undefined) return 0.7;
  if (area >= 50_000) return 1;
  if (area >= 10_000) return 0.85;
  return 0.6;
}

export function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const p1 = lat1 * rad;
  const p2 = lat2 * rad;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function jobAccess(lng: number, lat: number): [number, Extract<LocDetail, { type: "jobs" }>] {
  const cand = JOB_CENTERS.map(([name, x, y, w, core]) => {
    const d = haversineM(lng, lat, x, y);
    return { s: w * 100 * Math.exp(-Math.max(0, d - JOB_FREE_M) / JOB_DECAY_M), name, d, core };
  });
  // Python: 튜플 (점수, 이름, 거리, 도심) 내림차순
  cand.sort((a, b) => b.s - a.s || cmp(b.name, a.name) || b.d - a.d || Number(b.core) - Number(a.core));
  const [c1, c2] = cand;
  const anyS = 100 * (1 - (1 - c1.s / 100) * (1 - (JOB_SECOND * c2.s) / 100));
  const core = cand.find((c) => c.core)!;
  const score = JOB_CORE_SHARE * core.s + (1 - JOB_CORE_SHARE) * anyS;
  return [
    score,
    {
      type: "jobs",
      score: r1(score),
      name: c1.name,
      dist_m: Math.trunc(c1.d),
      second: { name: c2.name, dist_m: Math.trunc(c2.d) },
      core: { name: core.name, dist_m: Math.trunc(core.d), score: r1(core.s) },
    },
  ];
}

export function stationKey(name: string | null): string {
  const n = (name ?? "").replace(/\(.*?\)|\s/g, "");
  return n.endsWith("역") && n.length > 1 ? n.slice(0, -1) : n;
}

const LINE_RE = /(호선|선|라인|line|Line)$/;

export function stationLines(stations: ScorePoi[]): [number, string[], boolean] {
  const names = new Set<string>();
  for (const p of stations) {
    for (const raw of [p.subcategory, ...(p.line ?? "").split(";")]) {
      const v = (raw ?? "").trim();
      if (v && LINE_RE.test(v)) names.add(v);
    }
  }
  if (names.size) return [names.size, [...names].sort(cmp), false];
  const nodes = new Set(stations.filter((p) => p.source === "osm" && String(p.source_id ?? "").startsWith("node/")).map((p) => p.source_id));
  return [Math.max(nodes.size, 1), [], nodes.size > 1];
}

export function bestStation(cand: ScorePoi[], walk: number): [number, Record<string, unknown> | null] {
  const groups = new Map<string, ScorePoi[]>();
  for (const p of cand) {
    const k = stationKey(p.name);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const ordered = [...groups.entries()]
    .map(([k, ps]) => ({ k, ps, d: Math.min(...ps.map((p) => p.d)) }))
    .sort((a, b) => a.d - b.d || cmp(a.k, b.k));
  let best = 0;
  let info: Record<string, unknown> | null = null;
  for (const { k, ps, d } of ordered) {
    if (d > walk) continue;
    const [n, lines, guess] = stationLines(ps);
    const s = ((LINE_VALUE[n] ?? 100) * linear(d, walk * 0.4, walk)) / 100;
    if (info === null || s > best) {
      best = s;
      info = { name: k, lines, n_lines: n, dist_m: Math.trunc(d), ...(guess ? { guess: true } : {}) };
    }
  }
  return [best, info];
}

export function dedupe(cand: ScorePoi[]): ScorePoi[] {
  const seen = new Set<string>();
  const out: ScorePoi[] = [];
  for (const p of [...cand].sort((a, b) => a.d - b.d || cmp(a.name ?? "", b.name ?? ""))) {
    const name = (p.name ?? "").replace(/\s/g, "");
    const key = `${name}|${Math.floor(p.d / 50)}`;
    if (name && seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function match(p: ScorePoi, cats: string[], subs: Subs): boolean {
  if (!cats.includes(p.category)) return false;
  if (subs === null) return true;
  const sub = p.subcategory ?? "";
  if (Array.isArray(subs)) return subs.includes(sub);
  if (subs.like && !subs.like.some((k) => sub.includes(k))) return false;
  return !(subs.unlike && subs.unlike.some((k) => sub.includes(k)));
}

const subsList = (subs: Subs) => (Array.isArray(subs) ? [...subs] : null);

/**
 * → [총점, 항목별 결과]. lng/lat 이 없으면 직주근접은 계산하지 않는다(미수집).
 * available: 시설 자료가 있는 카테고리 — 없는 카테고리의 구성요소는 빼고 나머지 비중으로 다시 나눈다.
 */
export function scorePoint(poisIn: ScorePoi[], available: Set<string>, lng?: number, lat?: number): [number | null, Record<string, LocCategory>] {
  const pois = [...poisIn].sort((a, b) => a.d - b.d || cmp(a.name ?? "", b.name ?? ""));
  const result: Record<string, LocCategory> = {};
  let totalW = 0;
  let total = 0;
  for (const [key, [label, weight, comps]] of Object.entries(SPECS)) {
    let partScore = 0;
    let partShare = 0;
    const details: LocDetail[] = [];
    for (const [kind, cats, subs, prm, share] of comps) {
      if (kind === "jobs") {
        if (lng === undefined || lat === undefined) continue;
        const [s, det] = jobAccess(lng, lat);
        details.push(det);
        partScore += s * share;
        partShare += share;
        continue;
      }
      if (!cats.some((c) => available.has(c))) continue;
      let cand = pois.filter((p) => match(p, cats, subs));
      let s: number;
      if (kind === "near") {
        let near: ScorePoi | null = null;
        if (prm.sized) {
          const val = (p: ScorePoi) => linear(p.d, prm.good, prm.bad) * parkSizeFactor(p.area_m2);
          for (const p of cand) if (near === null || val(p) > val(near)) near = p;
          s = near ? val(near) : 0;
        } else {
          for (const p of cand) if (near === null || p.d < near.d) near = p;
          s = near ? linear(near.d, prm.good, prm.bad) : 0;
        }
        details.push({
          type: "near",
          cats,
          subs: subsList(subs),
          score: r1(s),
          name: near ? near.name : null,
          dist_m: near ? Math.trunc(near.d) : null,
          ...(prm.label ? { label: prm.label } : {}),
          ...(near && near.area_m2 ? { area_m2: Math.round(near.area_m2) } : {}),
        });
      } else if (kind === "lines") {
        const [bs, st] = bestStation(cand, prm.walk);
        s = bs;
        details.push({ type: "lines", cats, score: r1(s), walk: prm.walk, ...(st ?? { name: null }) } as LocDetail);
      } else if (kind === "count") {
        cand = dedupe(cand);
        const n = cand.filter((p) => p.d <= prm.r).length;
        const eff = cand.reduce((a, p) => a + decayWeight(p.d, prm.r), 0);
        s = saturate(eff, prm.k);
        details.push({
          type: "count",
          cats,
          subs: subsList(subs),
          ...(prm.label ? { label: prm.label } : {}),
          score: r1(s),
          count: n,
          eff: r1(eff),
          radius: prm.r,
          k: prm.k,
        });
      } else {
        const a = cand.filter((p) => p.d <= prm.r).reduce((acc, p) => acc + Number(p.area_1km || p.area_m2 || 0), 0);
        s = saturate(a, prm.k);
        details.push({ type: "area", cats, score: r1(s), area_m2: Math.round(a), radius: prm.r });
      }
      partScore += s * share;
      partShare += share;
    }
    if (!partShare) {
      result[key] = { label, score: null, status: "미수집" };
      continue;
    }
    const catScore = partScore / partShare;
    result[key] = { label, score: r1(catScore), weight, details };
    total += catScore * weight;
    totalW += weight;
  }
  // 시설 자료가 하나도 없으면(직주근접만 있으면) 총점은 비워 둔다
  if (!Object.entries(result).some(([k, v]) => k !== "jobs" && v.score !== null)) return [null, result];
  return [totalW ? r1(total / totalW) : null, result];
}
