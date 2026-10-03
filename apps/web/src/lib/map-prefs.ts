// 지도 화면 설정(서버·브라우저 공용): 유형·매매/전세·기간·조건·정렬·라벨·레이어·배경 지도.
// 기기별 쿠키에 저장해 서버가 첫 화면부터 그 값으로 그린다 — 마운트 뒤 localStorage 를 읽으면 첫 조회가 기본값으로 나가고,
// 저장 effect 가 읽기보다 먼저 돌면(개발 모드 이중 실행 등) 기본값으로 덮어써 설정이 계속 초기화됐다.
import { type DealKind, EMPTY_FILTERS, type MapFilters, type MapType, normalizeFilters, SORTS, type SortKey, TYPE_LAYERS } from "./map-filters";

export const MAP_PREFS_COOKIE = "map_prefs";
/** 예전 저장 위치(조건·정렬·라벨만) — 쿠키가 없을 때 한 번 옮긴다 */
export const LEGACY_FILTER_STORE = "map-filters-v1";

export const MAP_TYPES = ["apt", "officetel", "rowhouse", "house", "land", "commercial"] as const;
export const MAP_LAYER_KEYS = ["subway", "school", "park", "hospital", "mart", "zones", "infra", "movein", "cadastral", "zoning", "permit", "district_plan", "traffic"] as const;
/** 정비구역 사업 종류 묶음(지도 레이어 보기) */
export const ZONE_KINDS = [
  { key: "redev", label: "재개발" },
  { key: "rebuild", label: "재건축" },
  { key: "small", label: "소규모·기타" },
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number]["key"];
export function zoneKindOf(kind: string | null | undefined): ZoneKind {
  if (!kind) return "small";
  if (/소규모|가로주택|자율주택|리모델링/.test(kind)) return "small";
  if (kind.includes("재건축")) return "rebuild";
  if (kind.includes("재개발") || kind.includes("도시환경")) return "redev";
  return "small";
}
const ZONE_PHASE_KEYS = ["early", "union", "approved", "building", "done"] as const;
export const MAP_MONTHS = [3, 6, 12, 36] as const;
export const BASE_MAPS = ["normal", "satellite", "hybrid", "terrain"] as const;

export type MapPrefs = {
  type: string;
  /** 유형별 거래 종류(오피스텔은 월세, 아파트는 매매처럼 따로) — 그 유형에 없는 종류면 매매로 본다 */
  kindByType: Partial<Record<MapType, DealKind>>;
  months: number;
  /** 유형별 조건·정렬(토지의 지목 조건이 상가에 섞이지 않게, 오피스텔은 수익률 순을 기억하게) */
  filtersByType: Partial<Record<MapType, MapFilters>>;
  sortByType: Partial<Record<MapType, SortKey>>;
  labelMode: "unit" | "total";
  /** 유형별로 따로 기억하는 레이어(토지는 지적도·용도지역, 오피스텔은 역…). 없으면 그 유형의 추천 레이어 */
  layersByType: Partial<Record<MapType, string[]>>;
  baseMap: (typeof BASE_MAPS)[number];
  /** 정비구역 레이어에서 보일 단계 묶음·사업 종류(null 이면 전부) */
  zoneView: { phases: (typeof ZONE_PHASE_KEYS)[number][] | null; kinds: ZoneKind[] | null };
};

export const DEFAULT_MAP_PREFS: MapPrefs = {
  type: "apt",
  kindByType: {},
  months: 6,
  filtersByType: {},
  sortByType: {},
  labelMode: "unit",
  layersByType: {},
  baseMap: "normal",
  zoneView: { phases: null, kinds: null },
};

const has = <T>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** 그 유형의 조건·정렬(없으면 빈 조건·거래 많은 순) */
export function filtersFor(p: Pick<MapPrefs, "filtersByType">, type: string): MapFilters {
  return p.filtersByType[type as MapType] ?? EMPTY_FILTERS;
}
export function sortFor(p: Pick<MapPrefs, "sortByType">, type: string): SortKey {
  return p.sortByType[type as MapType] ?? "n";
}

/** 그 유형에서 켤 레이어: 기억한 것, 없으면 추천 */
export function layersFor(p: Pick<MapPrefs, "layersByType">, type: string): string[] {
  return p.layersByType[type as MapType] ?? TYPE_LAYERS[type as MapType] ?? TYPE_LAYERS.apt;
}

// 예전 '개발사업' 레이어(projects)는 정비구역·철도/도로 두 레이어로 나눴다
const layerList = (v: unknown) =>
  [...new Set((v as unknown[]).flatMap((l) => (l === "projects" ? ["zones", "infra"] : [l])).filter((l): l is (typeof MAP_LAYER_KEYS)[number] => has(MAP_LAYER_KEYS, l)))];

/** 저장된 값을 안전하게 읽는다(모르는 값은 기본값). 레이어를 모두 끈 빈 목록도 그대로 존중한다 */
export function normalizeMapPrefs(v: unknown): MapPrefs {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const d = DEFAULT_MAP_PREFS;
  const type: MapType = has(MAP_TYPES, o.type) ? o.type : "apt";
  const isSort = (v: unknown): v is SortKey => SORTS.some((x) => x.key === v);
  const filtersByType: MapPrefs["filtersByType"] = {};
  const sortByType: MapPrefs["sortByType"] = {};
  const fb = o.filtersByType && typeof o.filtersByType === "object" ? (o.filtersByType as Record<string, unknown>) : null;
  const sb = o.sortByType && typeof o.sortByType === "object" ? (o.sortByType as Record<string, unknown>) : null;
  for (const t of MAP_TYPES) {
    if (fb?.[t]) filtersByType[t] = normalizeFilters(fb[t]);
    if (isSort(sb?.[t])) sortByType[t] = sb[t] as SortKey;
  }
  // 예전 형식(유형 구분 없는 조건·정렬): 마지막에 보던 유형의 것으로
  if (!fb && o.filters) filtersByType[type] = normalizeFilters(o.filters);
  if (!sb && isSort(o.sort)) sortByType[type] = o.sort;
  return {
    type: has(MAP_TYPES, o.type) ? o.type : d.type,
    kindByType: normalizeKinds(o, type),
    months: has(MAP_MONTHS, o.months) ? o.months : d.months,
    filtersByType,
    sortByType,
    labelMode: o.labelMode === "total" ? "total" : "unit",
    layersByType: normalizeLayers(o, type),
    baseMap: has(BASE_MAPS, o.baseMap) ? o.baseMap : d.baseMap,
    zoneView: normalizeZoneView(o.zoneView),
  };
}

function normalizeZoneView(v: unknown): MapPrefs["zoneView"] {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const list = <T extends string>(x: unknown, all: readonly T[]): T[] | null => (Array.isArray(x) ? [...new Set(x.filter((k): k is T => has(all, k)))] : null);
  return { phases: list(o.phases, ZONE_PHASE_KEYS), kinds: list(o.kinds, ZONE_KINDS.map((k) => k.key)) };
}

const isKind = (v: unknown): v is DealKind => v === "sale" || v === "jeonse" || v === "wolse";

function normalizeKinds(o: Record<string, unknown>, type: MapType): MapPrefs["kindByType"] {
  const out: MapPrefs["kindByType"] = {};
  const by = o.kindByType && typeof o.kindByType === "object" ? (o.kindByType as Record<string, unknown>) : null;
  if (by) for (const t of MAP_TYPES) if (isKind(by[t])) out[t] = by[t] as DealKind;
  // 예전 형식(한 값)
  if (!by && isKind(o.kind) && o.kind !== "sale") out[type] = o.kind;
  return out;
}

function normalizeLayers(o: Record<string, unknown>, type: MapType): MapPrefs["layersByType"] {
  const out: MapPrefs["layersByType"] = {};
  const by = o.layersByType;
  if (by && typeof by === "object") {
    for (const t of MAP_TYPES) {
      const v = (by as Record<string, unknown>)[t];
      if (Array.isArray(v)) out[t] = layerList(v);
    }
  } else if (Array.isArray(o.layers)) {
    // 예전 형식(유형 구분 없는 한 목록): 마지막에 보던 유형의 것으로
    out[type] = layerList(o.layers);
  }
  return out;
}

/** 쿠키 값 → 설정. 없거나 깨졌으면 null */
export function parseMapPrefs(raw: string | null | undefined): MapPrefs | null {
  if (!raw) return null;
  for (const s of [raw, safeDecode(raw)]) {
    try {
      return normalizeMapPrefs(JSON.parse(s));
    } catch {
      /* 다음 방식으로 */
    }
  }
  return null;
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 쿠키에 넣을 문자열: 비어 있는 조건은 빼서 짧게 */
export function serializeMapPrefs(p: MapPrefs): string {
  // 빈 조건은 빼서 짧게(쿠키 4KB 한도)
  const compact = (f: MapFilters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && !v.length)));
  const filtersByType = Object.fromEntries(
    Object.entries(p.filtersByType)
      .map(([t, f]) => [t, compact(f)])
      .filter(([, f]) => Object.keys(f).length),
  );
  return JSON.stringify({ ...p, filtersByType });
}

/** 브라우저: 지금 쿠키의 설정(뒤로 가기로 예전 화면 데이터가 다시 쓰일 때도 최신 값을 쓰려고) */
export function readMapPrefsCookie(): MapPrefs | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${MAP_PREFS_COOKIE}=([^;]*)`));
  return m ? parseMapPrefs(m[1]) : null;
}

/** 브라우저: 저장(2년) */
export function writeMapPrefsCookie(p: MapPrefs) {
  document.cookie = `${MAP_PREFS_COOKIE}=${encodeURIComponent(serializeMapPrefs(p))}; path=/; max-age=${60 * 60 * 24 * 365 * 2}; samesite=lax`;
}
