// 지도 후보 탐색 필터(화면·API 공용). 값은 모두 기준 단위로 둔다:
// 가격 만원, 단위가격 평당 만원, 면적 ㎡, 준공 연도, 세대수, 전세가율·1년 변화·수익률 비율(0.7=70%), 입지 점수 0~100, 월세 만원,
// 용적률 %, 대지지분 ㎡.
// 부동산 유형마다 보는 것이 달라(오피스텔은 월세 수익률, 토지는 지목·용도지역·지분거래, 상가는 층·용도) 조건·정렬·묶음을 유형별로 둔다.

export type MapType = "apt" | "officetel" | "rowhouse" | "house" | "land" | "commercial";
export type DealKind = "sale" | "jeonse" | "wolse";

export const COMPLEX_TYPES = new Set(["apt", "officetel", "rowhouse"]);
const ALL: MapType[] = ["apt", "officetel", "rowhouse", "house", "land", "commercial"];
const COMPLEX: MapType[] = ["apt", "officetel", "rowhouse"];

/** 유형별 거래 종류 — 토지·상가는 임대 실거래가 공개되지 않는다 */
export const TYPE_KINDS: Record<MapType, DealKind[]> = {
  apt: ["sale", "jeonse", "wolse"],
  officetel: ["sale", "jeonse", "wolse"],
  rowhouse: ["sale", "jeonse", "wolse"],
  house: ["sale", "jeonse", "wolse"],
  land: ["sale"],
  commercial: ["sale"],
};

/** 그 유형에서 고를 수 없는 거래 종류면 매매로 */
export function kindFor(type: string, kind: DealKind): DealKind {
  return (TYPE_KINDS[type as MapType] ?? ["sale"]).includes(kind) ? kind : "sale";
}

/** 유형별 추천 레이어(처음 보거나 '추천으로' 눌렀을 때) */
export const TYPE_LAYERS: Record<MapType, string[]> = {
  apt: ["zones", "infra", "subway", "school"],
  officetel: ["subway", "infra", "hospital"],
  rowhouse: ["zones", "subway", "school"],
  house: ["zones", "school", "park"],
  land: ["cadastral", "zoning", "permit", "infra"],
  commercial: ["subway", "zoning"],
};

export type MapPoint = {
  key: string;
  kind: "complex" | "region";
  complex_id: number | null;
  name: string;
  lng: number;
  lat: number;
  n: number;
  /** 매매가·전세가 중위, 월세면 보증금 중위(만원) */
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
  /** 최근 7일 동네 이야기 새 글 수(단지) */
  talk?: number | null;
  /** 읍면동 집계(kind=region)의 법정동 코드 — 선택 카드가 그 동네 거래를 연다 */
  lawd_cd?: string | null;
  /** 월세 중위(만원, 월세 보기) */
  median_rent?: number | null;
  /** 추정 임대수익률(총): 최근 12개월 월세×12 ÷ (매매가 − 월세 보증금), ㎡당 중위로 계산 */
  rent_yield?: number | null;
  /** 대지 평당가(만원, 단독·다가구 매매) */
  land_ppy?: number | null;
  /** 지분 거래 비율(토지·상가, 고른 기간 매매) */
  share_ratio?: number | null;
  /** 법인 매수 비율(매수자 구분이 있는 매매) */
  corp_ratio?: number | null;
  /** 직거래 비율(고른 기간 매매) */
  direct_ratio?: number | null;
  /** 용적률(%, 건축물대장 — 아파트) */
  far?: number | null;
  /** 용적률 여유(%p) = 용도지역 상한 − 현재. 서울 밖은 법정 상한 기준(far_basis) */
  far_headroom?: number | null;
  far_basis?: "seoul" | "law" | null;
  /** 대지지분(㎡): 빌라는 고른 기간 매매의 대지권 면적 중위, 아파트는 대지면적 ÷ 세대수(평균) */
  land_share?: number | null;
  /** 대지지분 평당가(만원): 매매가 ÷ 대지지분(평) 중위 */
  land_share_ppy?: number | null;
  /** 수집 전 지역 미리보기(공공데이터 바로 조회, DB 에 저장 안 함) */
  live?: boolean;
  /** 미리보기 최근 거래(선택 카드용) */
  recent?: { date: string; price: number; rent: number | null; area: number | null; floor: number | null; name: string }[];
};

/** 세부 유형 묶음(단독은 주택 유형, 토지는 지목, 상가는 건물 용도) — 필터·요약이 같이 쓴다 */
export const CATEGORY_GROUPS: Record<"house" | "land" | "commercial", { key: string; label: string; values: string[] }[]> = {
  house: [
    { key: "single", label: "단독", values: ["단독"] },
    { key: "multi", label: "다가구", values: ["다가구"] },
  ],
  land: [
    { key: "site", label: "대지", values: ["대"] },
    { key: "farm", label: "농지(전·답·과수원)", values: ["전", "답", "과수원"] },
    { key: "forest", label: "임야", values: ["임야"] },
    { key: "misc", label: "잡종지", values: ["잡종지"] },
    { key: "factory", label: "공장·창고용지", values: ["공장용지", "창고용지"] },
    { key: "road", label: "도로·구거", values: ["도로", "구거", "하천", "유지", "제방"] },
  ],
  commercial: [
    { key: "near1", label: "1종 근린생활", values: ["제1종근린생활"] },
    { key: "near2", label: "2종 근린생활", values: ["제2종근린생활"] },
    { key: "office", label: "업무", values: ["업무"] },
    { key: "retail", label: "판매", values: ["판매"] },
    { key: "lodging", label: "숙박", values: ["숙박"] },
    { key: "edu", label: "교육연구", values: ["교육연구"] },
  ],
};

/** 용도지역 묶음(원천 용도지역 이름에 들어 있는 말로 고른다) */
export const ZONE_GROUPS: { key: string; label: string; match: string }[] = [
  { key: "res", label: "주거지역", match: "주거" },
  { key: "com", label: "상업지역", match: "상업" },
  { key: "ind", label: "공업지역", match: "공업" },
  { key: "green", label: "녹지지역", match: "녹지" },
  { key: "mgmt", label: "관리지역", match: "관리" },
  { key: "farm", label: "농림·보전", match: "농림|자연환경보전" },
];

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
  /** 추정 임대수익률 하한(0.05=5%) */
  yieldMin: number | null;
  /** 월세 상한(만원, 월세 보기) */
  rentMax: number | null;
  /** 세부 유형 묶음 key(CATEGORY_GROUPS) */
  cats: string[];
  /** 용도지역 묶음 key(ZONE_GROUPS) */
  zones: string[];
  /** 지분 거래 빼기(토지·상가) */
  noShare: boolean;
  /** 상가 건물 유형: 집합(구분 상가) · 일반(통건물) */
  bldg: "집합" | "일반" | null;
  /** 상가 층: 1층 · 2층 이상 */
  floor: "ground" | "upper" | null;
  /** 용적률 상한(%, 아파트 — 재건축 사업성) */
  farMax: number | null;
  /** 대지지분 하한(㎡, 아파트 세대당 평균·빌라 대지권) */
  lsMin: number | null;
};

type NumKey = { [K in keyof MapFilters]: MapFilters[K] extends number | null ? K : never }[keyof MapFilters];

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
  yieldMin: null,
  rentMax: null,
  cats: [],
  zones: [],
  noShare: false,
  bldg: null,
  floor: null,
  farMax: null,
  lsMin: null,
};

const PARAM: Record<NumKey, string> = {
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
  yieldMin: "yield_min",
  rentMax: "rent_max",
  farMax: "far_max",
  lsMin: "ls_min",
};
const NUM_KEYS = Object.keys(PARAM) as NumKey[];

// 허용 범위(벗어나면 무시)
const RANGE: Record<NumKey, [number, number]> = {
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
  yieldMin: [0, 0.5],
  rentMax: [0, 100_000],
  farMax: [0, 2000],
  lsMin: [0, 100_000],
};

/** 조건이 의미 있는 유형(그 밖의 유형에서는 화면에서 숨기고, 세지 않고, 서버도 무시한다) */
export const FILTER_TYPES: Record<keyof MapFilters, MapType[]> = {
  priceMin: ALL,
  priceMax: ALL,
  ppyMin: ALL,
  ppyMax: ALL,
  areaMin: ALL,
  areaMax: ALL,
  chgMin: ALL,
  chgMax: ALL,
  // 단독·상가는 거래마다 준공 연도가 있다(토지는 없음)
  yearMin: ["apt", "officetel", "rowhouse", "house", "commercial"],
  yearMax: ["apt", "officetel", "rowhouse", "house", "commercial"],
  hhMin: COMPLEX,
  jrMin: COMPLEX,
  jrMax: COMPLEX,
  locMin: COMPLEX,
  yieldMin: COMPLEX,
  rentMax: ["apt", "officetel", "rowhouse", "house"],
  cats: ["house", "land", "commercial"],
  zones: ["land", "commercial"],
  noShare: ["land", "commercial"],
  bldg: ["commercial"],
  floor: ["commercial"],
  farMax: ["apt"],
  lsMin: ["apt", "rowhouse"],
};

/** 단지 유형(아파트·오피스텔·빌라)에서만 의미가 있는 필터(이전 호환) */
export const COMPLEX_ONLY_FILTERS: (keyof MapFilters)[] = (Object.keys(FILTER_TYPES) as (keyof MapFilters)[]).filter((k) => FILTER_TYPES[k].every((t) => COMPLEX_TYPES.has(t)));

export function filterApplies(k: keyof MapFilters, type: string, kind: DealKind = "sale"): boolean {
  if (k === "rentMax" && kind !== "wolse") return false;
  return FILTER_TYPES[k].includes(type as MapType);
}

const isSet = (f: MapFilters, k: keyof MapFilters) => {
  const v = f[k];
  return Array.isArray(v) ? v.length > 0 : v !== null && v !== false;
};

/** 유형·거래 종류에 맞지 않는 조건을 뺀다(서버 집계·개수 세기 공용). 세부 유형은 그 유형의 묶음만 남긴다 */
export function applicableFilters(f: MapFilters, type: string, kind: DealKind = "sale"): MapFilters {
  const out = { ...EMPTY_FILTERS };
  for (const k of Object.keys(EMPTY_FILTERS) as (keyof MapFilters)[]) {
    if (filterApplies(k, type, kind)) (out as Record<string, unknown>)[k] = f[k];
  }
  const cats = (CATEGORY_GROUPS[type as keyof typeof CATEGORY_GROUPS] ?? []).map((g) => g.key);
  out.cats = out.cats.filter((c) => cats.includes(c));
  return out;
}

const keyList = (v: unknown, allowed: string[]): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : []);
const ALL_CATS = Object.values(CATEGORY_GROUPS).flatMap((g) => g.map((x) => x.key));
const ALL_ZONES = ZONE_GROUPS.map((z) => z.key);

export function filtersToQuery(f: MapFilters): string {
  const q = new URLSearchParams();
  for (const k of NUM_KEYS) {
    const v = f[k];
    if (v !== null && Number.isFinite(v)) q.set(PARAM[k], String(v));
  }
  if (f.cats.length) q.set("cats", f.cats.join(","));
  if (f.zones.length) q.set("zones", f.zones.join(","));
  if (f.noShare) q.set("no_share", "1");
  if (f.bldg) q.set("bldg", f.bldg);
  if (f.floor) q.set("floor", f.floor);
  return q.toString();
}

export function filtersFromQuery(sp: URLSearchParams): MapFilters {
  const out = { ...EMPTY_FILTERS };
  for (const k of NUM_KEYS) {
    const raw = sp.get(PARAM[k]);
    if (raw === null || raw.trim() === "") continue;
    const v = Number(raw);
    const [lo, hi] = RANGE[k];
    if (Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
  }
  out.cats = keyList((sp.get("cats") ?? "").split(","), ALL_CATS);
  out.zones = keyList((sp.get("zones") ?? "").split(","), ALL_ZONES);
  out.noShare = sp.get("no_share") === "1";
  const bldg = sp.get("bldg");
  out.bldg = bldg === "집합" || bldg === "일반" ? bldg : null;
  const floor = sp.get("floor");
  out.floor = floor === "ground" || floor === "upper" ? floor : null;
  return out;
}

/** 저장된 값(쿠키 등)을 안전하게 읽는다 */
export function normalizeFilters(v: unknown): MapFilters {
  const out = { ...EMPTY_FILTERS };
  if (!v || typeof v !== "object") return out;
  const o = v as Record<string, unknown>;
  for (const k of NUM_KEYS) {
    const x = o[k];
    const [lo, hi] = RANGE[k];
    if (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi) out[k] = x;
  }
  out.cats = keyList(o.cats, ALL_CATS);
  out.zones = keyList(o.zones, ALL_ZONES);
  out.noShare = o.noShare === true;
  out.bldg = o.bldg === "집합" || o.bldg === "일반" ? o.bldg : null;
  out.floor = o.floor === "ground" || o.floor === "upper" ? o.floor : null;
  return out;
}

/** 두 조건이 같은지(목록은 순서 무관) */
export function sameFilters(a: MapFilters, b: MapFilters): boolean {
  return (Object.keys(EMPTY_FILTERS) as (keyof MapFilters)[]).every((k) => {
    const x = a[k];
    const y = b[k];
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v) => y.includes(v));
    return x === y;
  });
}

/** 조건 단위(최소·최대는 한 조건) */
const FILTER_GROUPS: (keyof MapFilters)[][] = [
  ["priceMin", "priceMax"],
  ["ppyMin", "ppyMax"],
  ["areaMin", "areaMax"],
  ["yearMin", "yearMax"],
  ["hhMin"],
  ["jrMin", "jrMax"],
  ["chgMin", "chgMax"],
  ["locMin"],
  ["yieldMin"],
  ["rentMax"],
  ["cats"],
  ["zones"],
  ["noShare"],
  ["bldg"],
  ["floor"],
  ["farMax"],
  ["lsMin"],
];

/** 켜진 조건 개수 — 가격 6~10억처럼 최소·최대를 함께 줘도 한 개. 유형·거래 종류에 해당 없는 조건은 세지 않는다 */
export function activeFilterCount(f: MapFilters, type: string, kind: DealKind = "sale"): number {
  const a = applicableFilters(f, type, kind);
  return FILTER_GROUPS.filter((g) => g.some((k) => isSet(a, k))).length;
}

export type SortKey =
  | "n"
  | "price_asc"
  | "price_desc"
  | "ppy_asc"
  | "jr_desc"
  | "chg_desc"
  | "loc_desc"
  | "new"
  | "yield_desc"
  | "share_asc"
  | "rent_asc"
  | "far_asc"
  | "land_desc"
  | "landppy_asc";

export const SORTS: { key: SortKey; label: string; types?: MapType[]; kinds?: DealKind[] }[] = [
  { key: "n", label: "거래 많은 순" },
  { key: "price_asc", label: "가격 낮은 순" },
  { key: "price_desc", label: "가격 높은 순" },
  { key: "ppy_asc", label: "단위가격 낮은 순" },
  { key: "rent_asc", label: "월세 낮은 순", kinds: ["wolse"] },
  { key: "yield_desc", label: "임대수익률 높은 순", types: COMPLEX },
  { key: "jr_desc", label: "전세가율 높은 순", types: COMPLEX },
  { key: "chg_desc", label: "1년 상승률 순" },
  { key: "share_asc", label: "지분거래 적은 순", types: ["land", "commercial"] },
  { key: "loc_desc", label: "입지 점수 순", types: COMPLEX },
  { key: "new", label: "신축 순", types: COMPLEX },
  { key: "far_asc", label: "용적률 낮은 순", types: ["apt"] },
  { key: "land_desc", label: "대지지분 큰 순", types: ["apt", "rowhouse"] },
  { key: "landppy_asc", label: "대지지분 평당가 낮은 순", types: ["apt", "rowhouse"], kinds: ["sale"] },
];

export function sortsFor(type: string, kind: DealKind = "sale") {
  return SORTS.filter((s) => (!s.types || s.types.includes(type as MapType)) && (!s.kinds || s.kinds.includes(kind)));
}

/** 정렬: 값이 없는 항목은 항상 뒤로 */
export function sortPoints(points: MapPoint[], key: SortKey): MapPoint[] {
  const val: Record<SortKey, (p: MapPoint) => number | null> = {
    n: (p) => p.n,
    price_asc: (p) => -p.median_price,
    price_desc: (p) => p.median_price,
    ppy_asc: (p) => {
      const v = p.land_ppy ?? p.median_ppy;
      return v === null || v === undefined ? null : -v;
    },
    jr_desc: (p) => p.jeonse_ratio,
    chg_desc: (p) => p.change_1y,
    loc_desc: (p) => p.loc_score,
    new: (p) => p.build_year,
    yield_desc: (p) => p.rent_yield ?? null,
    share_asc: (p) => (p.share_ratio === null || p.share_ratio === undefined ? null : -p.share_ratio),
    rent_asc: (p) => (p.median_rent === null || p.median_rent === undefined ? null : -p.median_rent),
    far_asc: (p) => (p.far == null ? null : -p.far),
    land_desc: (p) => p.land_share ?? null,
    landppy_asc: (p) => (p.land_share_ppy == null ? null : -p.land_share_ppy),
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

export type FilterPreset = { key: string; label: string; filters: (thisYear: number) => Partial<MapFilters>; sort?: SortKey; types: MapType[]; hint?: string };

/** 자주 쓰는 조건 묶음(누르면 다른 필터는 지우고 이것만 적용) — 유형마다 사람들이 많이 찾는 것 */
export const FILTER_PRESETS: FilterPreset[] = [
  { key: "new", label: "신축(10년 이내)", filters: (y) => ({ yearMin: y - 10 }), sort: "new", types: ["apt", "officetel"] },
  { key: "small-gap", label: "갭 작은 곳(전세가율 70%+)", filters: () => ({ jrMin: 0.7 }), sort: "jr_desc", types: ["apt", "officetel"] },
  { key: "84-under10", label: "국민평형 10억 이하", filters: () => ({ areaMin: 80, areaMax: 90, priceMax: 100_000 }), sort: "price_asc", types: ["apt"] },
  { key: "rebuild", label: "재건축 연한(30년+)", filters: (y) => ({ yearMax: y - 30 }), types: ["apt"] },
  { key: "rising", label: "1년 +5% 이상", filters: () => ({ chgMin: 0.05 }), sort: "chg_desc", types: ALL },
  { key: "good-loc", label: "입지 70점+", filters: () => ({ locMin: 70 }), sort: "loc_desc", types: ["apt"] },
  { key: "rebuild-biz", label: "재건축 사업성(30년+·용적률 200%↓)", filters: (y) => ({ yearMax: y - 30, farMax: 200 }), sort: "far_asc", types: ["apt"], hint: "건축물대장을 받은 단지만(수집 지역에서 차례로 채움)" },
  // 수익형(오피스텔·빌라·아파트 월세)
  { key: "yield5", label: "임대수익률 5%+", filters: () => ({ yieldMin: 0.05 }), sort: "yield_desc", types: ["officetel", "rowhouse", "apt"], hint: "최근 1년 월세·매매로 낸 추정치" },
  { key: "studio", label: "원룸·소형(~40㎡)", filters: () => ({ areaMax: 40 }), sort: "yield_desc", types: ["officetel"] },
  // 빌라: 전세 위험·재개발
  { key: "gap-risk", label: "깡통 위험(전세가율 80%+)", filters: () => ({ jrMin: 0.8 }), sort: "jr_desc", types: ["rowhouse"], hint: "전세로 들어갈 때 조심할 곳" },
  { key: "new-villa", label: "신축 빌라(5년 이내)", filters: (y) => ({ yearMin: y - 5 }), sort: "new", types: ["rowhouse"], hint: "신축 빌라는 시세가 불투명해 전세 사고가 잦다" },
  { key: "old-villa", label: "노후(30년+, 재개발 관심)", filters: (y) => ({ yearMax: y - 30 }), types: ["rowhouse"] },
  { key: "land10", label: "대지지분 10평+", filters: () => ({ lsMin: 33 }), sort: "landppy_asc", types: ["rowhouse"], hint: "재개발 권리가액은 대지지분이 클수록 유리 — 대지지분 평당가로 비교" },
  // 단독·다가구
  { key: "multi", label: "다가구(임대용)", filters: () => ({ cats: ["multi"] }), types: ["house"] },
  { key: "single", label: "단독주택", filters: () => ({ cats: ["single"] }), types: ["house"] },
  { key: "old-house", label: "노후(30년+)", filters: (y) => ({ yearMax: y - 30 }), types: ["house"], hint: "신축 부지·재개발 관점" },
  // 토지
  { key: "site", label: "대지(지분 제외)", filters: () => ({ cats: ["site"], noShare: true }), sort: "ppy_asc", types: ["land"] },
  { key: "farm", label: "농지(지분 제외)", filters: () => ({ cats: ["farm"], noShare: true }), sort: "ppy_asc", types: ["land"], hint: "취득 때 농지취득자격증명 필요" },
  { key: "mgmt", label: "관리지역 토지", filters: () => ({ zones: ["mgmt"], noShare: true }), sort: "ppy_asc", types: ["land"], hint: "계획관리지역은 개발 가능한 용도가 넓다" },
  { key: "no-share", label: "지분거래 빼고 보기", filters: () => ({ noShare: true }), types: ["land", "commercial"], hint: "기획부동산식 지분 쪼개기 거래를 뺀 시세" },
  // 상가
  { key: "ground", label: "1층 상가", filters: () => ({ bldg: "집합", floor: "ground" }), sort: "ppy_asc", types: ["commercial"] },
  { key: "whole", label: "통건물(일반 건물)", filters: () => ({ bldg: "일반" }), types: ["commercial"] },
  { key: "neighborhood", label: "근린생활시설", filters: () => ({ cats: ["near1", "near2"] }), types: ["commercial"] },
];

export function presetsFor(type: string): FilterPreset[] {
  return FILTER_PRESETS.filter((p) => p.types.includes(type as MapType));
}
