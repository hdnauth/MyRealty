// 지도 후보 탐색 필터(화면·API 공용). 값은 모두 기준 단위로 둔다:
// 가격 만원, 단위가격 평당 만원, 면적 ㎡, 준공 연도, 세대수, 전세가율·1년 변화 비율(0.7=70%), 입지 점수 0~100.

export type MapPoint = {
  key: string;
  kind: "complex" | "region";
  complex_id: number | null;
  name: string;
  lng: number;
  lat: number;
  n: number;
  median_price: number;
  median_ppy: number | null; // 평당가(만원)
  last_date: string;
  build_year: number | null;
  households: number | null;
  /** 최근 12개월 전세 ㎡당 중위 ÷ 매매 ㎡당 중위 */
  jeonse_ratio: number | null;
  /** 최근 6개월 매매 ㎡당 중위 ÷ 12~18개월 전 − 1 */
  change_1y: number | null;
  /** 생활편의(입지) 점수 0~100 */
  loc_score: number | null;
};

export type MapFilters = {
  priceMin: number | null;
  priceMax: number | null;
  ppyMin: number | null;
  ppyMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  hhMin: number | null;
  jrMin: number | null;
  jrMax: number | null;
  chgMin: number | null;
  chgMax: number | null;
  locMin: number | null;
};

export const EMPTY_FILTERS: MapFilters = {
  priceMin: null,
  priceMax: null,
  ppyMin: null,
  ppyMax: null,
  areaMin: null,
  areaMax: null,
  yearMin: null,
  yearMax: null,
  hhMin: null,
  jrMin: null,
  jrMax: null,
  chgMin: null,
  chgMax: null,
  locMin: null,
};

const PARAM: Record<keyof MapFilters, string> = {
  priceMin: "price_min",
  priceMax: "price_max",
  ppyMin: "ppy_min",
  ppyMax: "ppy_max",
  areaMin: "area_min",
  areaMax: "area_max",
  yearMin: "year_min",
  yearMax: "year_max",
  hhMin: "hh_min",
  jrMin: "jr_min",
  jrMax: "jr_max",
  chgMin: "chg_min",
  chgMax: "chg_max",
  locMin: "loc_min",
};

// 허용 범위(벗어나면 무시)
const RANGE: Record<keyof MapFilters, [number, number]> = {
  priceMin: [0, 10_000_000],
  priceMax: [0, 10_000_000],
  ppyMin: [0, 1_000_000],
  ppyMax: [0, 1_000_000],
  areaMin: [0, 10_000_000],
  areaMax: [0, 10_000_000],
  yearMin: [1900, 2100],
  yearMax: [1900, 2100],
  hhMin: [0, 100_000],
  jrMin: [0, 3],
  jrMax: [0, 3],
  chgMin: [-1, 10],
  chgMax: [-1, 10],
  locMin: [0, 100],
};

/** 단지 유형(아파트·오피스텔·빌라)에서만 의미가 있는 필터 */
export const COMPLEX_ONLY_FILTERS: (keyof MapFilters)[] = ["yearMin", "yearMax", "hhMin", "locMin"];
export const COMPLEX_TYPES = new Set(["apt", "officetel", "rowhouse"]);

export function filtersToQuery(f: MapFilters): string {
  const q = new URLSearchParams();
  for (const k of Object.keys(PARAM) as (keyof MapFilters)[]) {
    const v = f[k];
    if (v !== null && Number.isFinite(v)) q.set(PARAM[k], String(v));
  }
  return q.toString();
}

export function filtersFromQuery(sp: URLSearchParams): MapFilters {
  const out = { ...EMPTY_FILTERS };
  for (const k of Object.keys(PARAM) as (keyof MapFilters)[]) {
    const raw = sp.get(PARAM[k]);
    if (raw === null || raw.trim() === "") continue;
    const v = Number(raw);
    const [lo, hi] = RANGE[k];
    if (Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
  }
  return out;
}

/** 저장된 값(localStorage 등)을 안전하게 읽는다 */
export function normalizeFilters(v: unknown): MapFilters {
  const out = { ...EMPTY_FILTERS };
  if (!v || typeof v !== "object") return out;
  for (const k of Object.keys(PARAM) as (keyof MapFilters)[]) {
    const x = (v as Record<string, unknown>)[k];
    const [lo, hi] = RANGE[k];
    if (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi) out[k] = x;
  }
  return out;
}

/** 켜진 필터 개수(유형에 해당 없는 필터는 세지 않는다) */
export function activeFilterCount(f: MapFilters, type: string): number {
  const complex = COMPLEX_TYPES.has(type);
  return (Object.keys(PARAM) as (keyof MapFilters)[]).filter((k) => f[k] !== null && (complex || !COMPLEX_ONLY_FILTERS.includes(k))).length;
}

export type SortKey = "n" | "price_asc" | "price_desc" | "ppy_asc" | "jr_desc" | "chg_desc" | "loc_desc" | "new";

export const SORTS: { key: SortKey; label: string; complexOnly?: boolean }[] = [
  { key: "n", label: "거래 많은 순" },
  { key: "price_asc", label: "가격 낮은 순" },
  { key: "price_desc", label: "가격 높은 순" },
  { key: "ppy_asc", label: "단위가격 낮은 순" },
  { key: "jr_desc", label: "전세가율 높은 순" },
  { key: "chg_desc", label: "1년 상승률 순" },
  { key: "loc_desc", label: "입지 점수 순", complexOnly: true },
  { key: "new", label: "신축 순", complexOnly: true },
];

/** 정렬: 값이 없는 항목은 항상 뒤로 */
export function sortPoints(points: MapPoint[], key: SortKey): MapPoint[] {
  const val: Record<SortKey, (p: MapPoint) => number | null> = {
    n: (p) => p.n,
    price_asc: (p) => -p.median_price,
    price_desc: (p) => p.median_price,
    ppy_asc: (p) => (p.median_ppy === null ? null : -p.median_ppy),
    jr_desc: (p) => p.jeonse_ratio,
    chg_desc: (p) => p.change_1y,
    loc_desc: (p) => p.loc_score,
    new: (p) => p.build_year,
  };
  const f = val[key];
  return [...points].sort((a, b) => {
    const x = f(a);
    const y = f(b);
    if (x === null && y === null) return b.n - a.n;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || b.n - a.n;
  });
}

export type FilterPreset = { key: string; label: string; filters: (thisYear: number) => Partial<MapFilters>; sort?: SortKey; complexOnly?: boolean };

/** 자주 쓰는 조건 묶음(누르면 다른 필터는 지우고 이것만 적용). 세대수·입지 점수는 채워진 단지가 적어 묶음에 넣지 않는다 */
export const FILTER_PRESETS: FilterPreset[] = [
  { key: "new", label: "신축(10년 이내)", filters: (y) => ({ yearMin: y - 10 }), sort: "new", complexOnly: true },
  { key: "small-gap", label: "갭 작은 곳(전세가율 70%+)", filters: () => ({ jrMin: 0.7 }), sort: "jr_desc" },
  { key: "84-under10", label: "국민평형 10억 이하", filters: () => ({ areaMin: 80, areaMax: 90, priceMax: 100_000 }), sort: "price_asc" },
  { key: "rebuild", label: "재건축 연한(30년+)", filters: (y) => ({ yearMax: y - 30 }), complexOnly: true },
  { key: "rising", label: "1년 +5% 이상", filters: () => ({ chgMin: 0.05 }), sort: "chg_desc" },
  { key: "good-loc", label: "입지 70점+", filters: () => ({ locMin: 70 }), sort: "loc_desc", complexOnly: true },
];
