"use client";

import clsx from "clsx";
import "leaflet/dist/leaflet.css";
import { ChevronLeft, Crosshair, Layers, List, Loader2, Maximize2, Minimize2, Star, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type AreaUnit, formatDate, formatManwon, formatPct, fromPerPyeong, shortAddress, unitPriceLabel } from "@/lib/format";
import { complexHref, type MyComplexes, naverLandHref, regionHref, registerComplexHref } from "@/lib/links";
import { REGION_TYPE_INFO, type RegionMarket, isRegionType } from "@/lib/region-market";
import type { MapOverlays } from "@/app/api/map/overlays/route";
import type { MapSearchResult } from "@/app/api/map/search/route";
import { activeFilterCount, COMPLEX_TYPES, type DealKind, EMPTY_FILTERS, filtersToQuery, kindFor, type MapFilters, type MapPoint, type MapType, normalizeFilters, SORTS, type SortKey, sortPoints, sortsFor, TYPE_KINDS, TYPE_LAYERS } from "@/lib/map-filters";
import { DEFAULT_MAP_PREFS, filtersFor, LEGACY_FILTER_STORE, layersFor, type MapPrefs, readMapPrefsCookie, sortFor, writeMapPrefsCookie, ZONE_KINDS, zoneKindOf } from "@/lib/map-prefs";
import { PHASE_COLOR, ZONE_PHASES, ZONE_STAGES, zonePhase } from "@/lib/projects";
import type { LocSummary } from "@/lib/location-score";
import { DEAL_KIND_LABEL, GROUP_TAGS, isPropertyType, PROPERTY_TYPES } from "@/lib/property";
import { ComplexTrades, type Trade } from "./complex-trades";
import { RegionTrades } from "./region-trades";
import { CoverageNote } from "./coverage-note";
import { MapIntro } from "./map-intro";
import { FilterBar, FilterPanel } from "./filter-panel";
import { LocBars } from "./loc-bars";
import { MapSearch } from "./map-search";
import { type BaseMap, type BBox, clusterByDistance, createLeafletMap, distanceKm, createNaverMap, loadLeaflet, loadNaver, type MapHandle, type Removable, declutter, pinLabel, satelliteSources, shortName, tileSources, vworldWmsUrl } from "./engines";

export type MapWatchItem = {
  id: string;
  label: string;
  lng: number;
  lat: number;
  radius_m: number;
  property_type: string;
  group_tag: string;
  complex_id: number | null;
  /** 필지 경계 표시용(토지·임야·단독 등) */
  pnu: string | null;
  area_m2: number | null;
  estimate: number | null;
  last_price: number | null;
  last_date: string | null;
};
export type MapFocusComplex = { id: number; name: string; property_type: string; lng: number; lat: number };
export type MapEvent = { id: number; title: string; kind: string; lng: number; lat: number; starts_on: string | null; households: number | null };
export type MapProject = {
  type: "zone" | "infra";
  id: number;
  name: string;
  kind: string;
  status: string | null;
  step: number | null;
  expected_open: string | null;
  lng: number;
  lat: number;
  /** 계획 도로: 도시계획 결정 고시일 */
  notice_date?: string | null;
};
/** 개발·테마에서 골라 들어온 사업(/map?zone= · ?infra=) — 경계(GeoJSON MultiPolygon)가 있으면 강조해 그린다 */
export type MapFocusProject = MapProject & { shape: string | null };
type MapPoi = { id: number; category: string; subcategory: string | null; name: string; lng: number; lat: number };

const LAYER_GROUPS = [
  {
    title: "주변 시설",
    layers: [
      { key: "subway", label: "🚇 지하철·철도역" },
      { key: "school", label: "🏫 학교" },
      { key: "park", label: "🌳 공원" },
      { key: "hospital", label: "🏥 병원" },
      { key: "mart", label: "🛒 마트·백화점" },
    ],
  },
  {
    title: "개발 · 공급",
    layers: [
      { key: "zones", label: "🏗 정비구역(재개발·재건축, 숫자=단계)" },
      { key: "infra", label: "🚆 철도·도로 사업" },
      { key: "movein", label: "🏠 입주 예정" },
    ],
  },
  {
    title: "필지 · 규제",
    layers: [
      { key: "cadastral", label: "지적도(필지 경계)" },
      { key: "zoning", label: "용도지역" },
      { key: "permit", label: "토지거래허가구역" },
      { key: "district_plan", label: "지구단위계획구역" },
    ],
  },
  { title: "교통", layers: [{ key: "traffic", label: "실시간 교통정보(네이버 지도)" }] },
] as const;
const POI_LAYERS = new Set(["subway", "school", "park", "hospital", "mart"]);
const BASE_MAPS: { key: BaseMap; label: string }[] = [
  { key: "normal", label: "일반" },
  { key: "satellite", label: "위성" },
  { key: "hybrid", label: "위성+지명" },
  { key: "terrain", label: "지형" },
];
// 지도 위에 이미지를 덮는 레이어(브이월드 WMS). 지적도는 네이버 지도에서는 자체 지적편집도를 쓴다
const ZONING_LAYERS = ["lt_c_uq111", "lt_c_uq112", "lt_c_uq113", "lt_c_uq114"];
const CADASTRAL_LAYERS = ["lp_pa_cbnd_bubun", "lp_pa_cbnd_bonbun"];
const POI_STYLE: Record<string, { bg: string; icon: string }> = {
  subway: { bg: "#2a78d6", icon: "🚇" },
  school: { bg: "#1baf7a", icon: "🏫" },
  park: { bg: "#008300", icon: "🌳" },
  hospital: { bg: "#e34948", icon: "🏥" },
  mart: { bg: "#eb6834", icon: "🛒" },
};

const TYPE_OPTIONS = [
  { key: "apt", label: "아파트" },
  { key: "officetel", label: "오피스텔" },
  { key: "rowhouse", label: "빌라" },
  { key: "house", label: "단독" },
  { key: "land", label: "토지" },
  { key: "commercial", label: "상가" },
];
/*
 * 목록 시트(모바일): 지도를 가리지 않게 평소엔 머리만(peek), 단지를 고르면 반(half), 끌어 올리면 전체(full).
 * 데스크톱(lg)에서는 왼쪽 옆 패널(접기 가능).
 */
type SheetState = "peek" | "half" | "full";
const SHEET_H: Record<SheetState, string> = { peek: "3.5rem", half: "45%", full: "calc(100% - 0.5rem)" };
const SHEET_ORDER: SheetState[] = ["peek", "half", "full"];

const txOf = (it: MapWatchItem | undefined) => (it && isPropertyType(it.property_type) ? PROPERTY_TYPES[it.property_type].tx : null);

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** 이 확대 단계(약 1.5km 폭) 이상에서만 화면 안 단지 입지 점수를 즉석으로 채운다 — 넓은 화면에서 수백 곳을 계산하지 않게 */
const LOC_ZOOM = 15;
/** 한 번에 묻는 단지 수(화면 가운데에 가까운 순) */
const LOC_BATCH = 30;
/** 한 화면에서 '남은 단지' 다시 묻기 횟수 */
const LOC_ROUNDS = 4;

/** 라벨·목록 보조 지표: 정렬 기준에 맞춰 보여 준다 */
function metricText(p: MapPoint, sort: SortKey): string | null {
  switch (sort) {
    case "jr_desc":
      return p.jeonse_ratio !== null ? `전세가율 ${Math.round(p.jeonse_ratio * 100)}%` : null;
    case "chg_desc":
      return p.change_1y !== null ? `1년 ${formatPct(p.change_1y, 1)}` : null;
    case "loc_desc":
      return p.loc_score !== null ? `입지 ${Math.round(p.loc_score)}점` : null;
    case "new":
      return p.build_year ? `${p.build_year}년` : null;
    case "yield_desc":
      return p.rent_yield != null ? `수익률 ${formatPct(p.rent_yield, 1, false)}` : null;
    case "share_asc":
      return p.share_ratio != null ? `지분 ${Math.round(p.share_ratio * 100)}%` : null;
    case "rent_asc":
      return p.median_rent != null ? `월 ${Math.round(p.median_rent)}만` : null;
    default:
      return null;
  }
}

/** 지분거래가 이만큼 넘으면 라벨·카드에 경고(기획부동산식 지분 쪼개기 판매가 많은 곳) */
const SHARE_WARN = 0.3;

/** 단지·동네 지표 요약(목록·선택 카드) — 유형마다 보는 것이 다르다 */
function indicatorBits(p: MapPoint, unit: AreaUnit): string[] {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return [
    p.build_year ? `${p.build_year}년` : null,
    p.households ? `${p.households.toLocaleString()}세대` : null,
    p.rent_yield != null ? `임대수익률 ${formatPct(p.rent_yield, 1, false)}` : null,
    p.jeonse_ratio !== null ? `전세가율 ${Math.round(p.jeonse_ratio * 100)}%` : null,
    p.change_1y !== null ? `1년 ${formatPct(p.change_1y, 1)}` : null,
    p.loc_score !== null ? `입지 ${Math.round(p.loc_score)}점` : null,
    p.land_ppy != null ? `대지 ${unitPriceLabel(unit)} ${formatManwon(fromPerPyeong(p.land_ppy, unit), { short: true })}` : null,
    p.share_ratio != null && p.share_ratio > 0 ? `${p.share_ratio >= SHARE_WARN ? "⚠ " : ""}지분거래 ${pct(p.share_ratio)}` : null,
    p.direct_ratio != null && p.direct_ratio >= 0.5 ? `직거래 ${pct(p.direct_ratio)}` : null,
    p.corp_ratio != null && p.corp_ratio >= 0.2 ? `법인 매수 ${pct(p.corp_ratio)}` : null,
  ].filter((x): x is string => x !== null);
}

/** 라벨 큰 글씨: 월세는 보증금/월세, 단위가격 보기는 유형별 기준 면적(단독은 대지)의 평당·㎡당, 아니면 거래가 중위 */
function mainLabel(p: MapPoint, kind: DealKind, mode: "unit" | "total", unit: AreaUnit): string {
  if (kind === "wolse") return `${formatManwon(p.median_price, { short: true })}/${p.median_rent != null ? `${Math.round(p.median_rent)}만` : "-"}`;
  const ppy = p.land_ppy ?? p.median_ppy;
  if (mode === "unit" && ppy) return `${formatManwon(fromPerPyeong(ppy, unit), { short: true })}/${unit === "pyeong" ? "평" : "㎡"}`;
  return formatManwon(p.median_price, { short: true });
}

/** 가격 라벨 단위가격의 기준 면적 이름 */
const UNIT_BASIS: Record<string, string> = { apt: "전용", officetel: "전용", rowhouse: "전용", house: "대지", land: "토지", commercial: "건물" };

/** 아직 집계에 없는 단지(검색·링크로 고른 단지)를 선택 상태로 둘 때 — 집계가 오면 그 값으로 바뀐다 */
function stubPoint(c: { id: number; name: string; lng: number; lat: number }): MapPoint {
  return { key: `c${c.id}`, kind: "complex", complex_id: c.id, name: c.name, lng: c.lng, lat: c.lat, n: 0, median_price: 0, median_ppy: null, last_date: "", build_year: null, households: null, jeonse_ratio: null, change_1y: null, loc_score: null };
}

/** 라벨 앞 1년 변동 화살표(아실·호갱노노식 상승 빨강/하락 파랑). ±1% 미만은 표시하지 않는다 */
function changeArrow(chg: number | null): string {
  if (chg === null || Math.abs(chg) < 0.01) return "";
  return chg > 0 ? `<span style="color:#e5383b">▲</span>` : `<span style="color:#2f6fdf">▼</span>`;
}

export function RealtyMap({
  keyId,
  vworldKey = null,
  vworldDomain = null,
  items,
  events,
  initialCenter,
  focusItemId = null,
  unit = "m2",
  missingItems = [],
  focusComplex = null,
  atPoint = null,
  initialType = null,
  initialLayers = null,
  initialPrefs = null,
  focusProject = null,
  complexItems = {},
}: {
  /** 처음 골라 둘 개발사업(/map?zone= · ?infra=) */
  focusProject?: MapFocusProject | null;
  /** 이 기기에 저장된 지도 설정(쿠키) — 없으면 기본값 */
  initialPrefs?: MapPrefs | null;
  /** 처음 골라 둘 단지(/map?complex=) */
  focusComplex?: MapFocusComplex | null;
  /** 처음 표시할 위치(/map?at=경도,위도) — 단지 없는 거래 위치 */
  atPoint?: [number, number] | null;
  /** 처음 거래 유형 필터(/map?type=) */
  initialType?: string | null;
  /** ?layers= 로 켜고 시작할 레이어(기본 레이어에 더한다) */
  initialLayers?: string[] | null;
  /** 단지 id → 내 관심 부동산 id(선택 카드의 '상세' 링크) */
  complexItems?: MyComplexes;
  /** 좌표를 못 찾은 관심 부동산(목록에만 안내) */
  missingItems?: { id: string; label: string }[];
  /** 처음 선택할 관심 부동산(/map?item=) */
  focusItemId?: string | null;
  unit?: AreaUnit;
  /** 네이버 클라우드 Maps Client ID. 없거나 인증에 실패하면 Leaflet 대체 지도로 그린다. */
  keyId: string | null;
  /** 대체 지도 배경(브이월드 WMTS). 없으면 OpenStreetMap */
  vworldKey?: string | null;
  vworldDomain?: string | null;
  items: MapWatchItem[];
  events: MapEvent[];
  initialCenter: [number, number];
}) {
  const el = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const markersRef = useRef<Removable[]>([]);
  const layerMarkersRef = useRef<Removable[]>([]);
  // 지도가 새로 만들어질 때마다 올라가 마커 effect 를 다시 돌린다(네이버 → 대체 지도 전환 포함)
  const [mapVersion, setMapVersion] = useState(0);
  const [engine, setEngine] = useState<"naver" | "leaflet">(keyId ? "naver" : "leaflet");
  const [notice, setNotice] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(focusItemId);
  const focus = items.find((i) => i.id === focusId) ?? null;
  const [sheet, setSheet] = useState<SheetState>(focusItemId || focusComplex || atPoint ? "half" : "peek");
  // 데스크톱 옆 패널 펼침
  const [sideOpen, setSideOpen] = useState(true);
  const [mineOpen, setMineOpen] = useState(false);
  // 저장된 설정: 지금 쿠키를 먼저 본다(뒤로 가기로 예전 화면 데이터가 다시 쓰여도 마지막 설정으로). 서버도 같은 쿠키로 그려 하이드레이션 값이 같다
  const [prefs0] = useState<MapPrefs>(() => readMapPrefsCookie() ?? initialPrefs ?? DEFAULT_MAP_PREFS);
  // 쿠키가 없던 기기: 예전 저장소(localStorage)의 조건을 한 번 옮긴다
  const [legacyStore] = useState(() => !initialPrefs && !readMapPrefsCookie());
  // 관심 부동산·단지를 골라 들어오면 그 유형의 거래를 보여 준다. 아니면 마지막에 보던 유형
  const [type, setType] = useState<string>(() => {
    const t = initialType === "forest" ? "land" : initialType;
    if (t && TYPE_OPTIONS.some((o) => o.key === t)) return t;
    return txOf(items.find((i) => i.id === focusItemId)) ?? prefs0.type;
  });
  // 거래 종류도 유형별로 기억한다(오피스텔은 월세, 아파트는 매매). 토지·상가는 임대 실거래가 없어 매매로만 본다
  const [kindByType, setKindByType] = useState<MapPrefs["kindByType"]>(prefs0.kindByType);
  const effKind = kindFor(type, kindByType[type as MapType] ?? "sale");
  const setKind = (k: DealKind) => setKindByType((prev) => ({ ...prev, [type]: k }));
  const [months, setMonths] = useState(prefs0.months);
  const [rawPoints, setPoints] = useState<MapPoint[]>([]);
  // 즉석으로 받은 입지 점수(단지 id → 요약). 집계에 점수가 없던 단지는 이 값으로 채워 라벨·정렬·필터 표시에 쓴다
  const [locCache, setLocCache] = useState<Record<number, LocSummary>>({});
  const locRef = useRef(locCache);
  useEffect(() => {
    locRef.current = locCache;
  }, [locCache]);
  const points = useMemo(
    () =>
      rawPoints.map((p) => {
        const l = p.complex_id !== null ? locCache[p.complex_id] : undefined;
        return l && p.loc_score === null && l.total !== null ? { ...p, loc_score: l.total } : p;
      }),
    [rawPoints, locCache],
  );
  const [truncated, setTruncated] = useState(false);
  // 화면 이동·조건 변경마다 다시 조회한다. 진행·실패를 보여 줘야 이전 결과가 남아 있는 것과 구분된다
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // 후보 탐색 조건·정렬(이 기기에 기억)
  // 조건·정렬은 유형별로 기억한다(토지의 지목 조건이 상가에 섞이지 않고, 오피스텔은 수익률 순을 기억)
  const [filtersByType, setFiltersByType] = useState<MapPrefs["filtersByType"]>(prefs0.filtersByType);
  const [sortByType, setSortByType] = useState<MapPrefs["sortByType"]>(prefs0.sortByType);
  const filters = filtersFor({ filtersByType }, type);
  const sort = sortFor({ sortByType }, type);
  const setFilters = useCallback((f: MapFilters) => setFiltersByType((prev) => ({ ...prev, [type]: f })), [type]);
  const setSort = useCallback((k: SortKey) => setSortByType((prev) => ({ ...prev, [type]: k })), [type]);
  // 라벨 큰 글씨: 단위가격(평당·㎡당) 또는 거래가(중위) — 단독·토지·상가는 늘 거래가
  const [labelMode, setLabelMode] = useState<"unit" | "total">(prefs0.labelMode);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterCount = activeFilterCount(filters, type, effKind);
  // 유형을 바꿨는데 그 유형에 없는 정렬(입지·신축)이면 기본으로
  const typeSorts = sortsFor(type, effKind);
  const sortKey: SortKey = typeSorts.some((x) => x.key === sort) ? sort : "n";
  // 전체 화면: 브라우저 전체 화면(Fullscreen API), 안 되면(iPhone Safari 등) 화면을 덮는 고정 배치
  const [fullscreen, setFullscreen] = useState<"off" | "native" | "css">("off");
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(() => (focusComplex ? stubPoint(focusComplex) : null));
  const [detail, setDetail] = useState<{ complex: { name: string; build_year: number | null; households: number | null }; trades: Trade[]; talk?: { total: number; recent: number } } | null>(null);
  // 레이어는 유형별로 기억한다(토지는 지적도·용도지역, 오피스텔은 역…). 처음 보는 유형은 추천 레이어. ?layers= 는 처음 유형에 더한다
  const [layersByType, setLayersByType] = useState<MapPrefs["layersByType"]>(() =>
    initialLayers?.length ? { ...prefs0.layersByType, [type]: [...new Set([...layersFor(prefs0, type), ...initialLayers])] } : prefs0.layersByType,
  );
  // 용도지역은 브이월드 키가 있어야 그린다 — 키가 없으면 추천에서 뺀다(켤 때마다 안내가 뜨지 않게)
  const recommended = useMemo(() => (TYPE_LAYERS[type as MapType] ?? TYPE_LAYERS.apt).filter((l) => vworldKey || l !== "zoning"), [type, vworldKey]);
  const layers = useMemo(() => new Set(layersByType[type as MapType] ?? recommended), [layersByType, type, recommended]);
  const [pois, setPois] = useState<MapPoi[]>([]);
  const [poiNote, setPoiNote] = useState<string | null>(null);
  const [poiInfo, setPoiInfo] = useState<MapPoi | null>(null);
  const [projectInfo, setProjectInfo] = useState<MapProject | null>(focusProject);
  // 정비구역 레이어에서 보일 단계 묶음·사업 종류(이 기기에 기억, null 이면 전부)
  const [zoneView, setZoneView] = useState<MapPrefs["zoneView"]>(prefs0.zoneView);
  const zoneShown = useCallback(
    (kind: string | null, step: number | null) => {
      const ph = zonePhase(step) ?? "early";
      return (!zoneView.phases || zoneView.phases.includes(ph)) && (!zoneView.kinds || zoneView.kinds.includes(zoneKindOf(kind)));
    },
    [zoneView],
  );
  const [layerOpen, setLayerOpen] = useState(false);
  const [baseMap, setBaseMap] = useState<BaseMap>(prefs0.baseMap);
  const [locating, setLocating] = useState(false);
  const meRef = useRef<Removable[]>([]);
  useEffect(() => {
    if (!legacyStore) return;
    try {
      const v = JSON.parse(localStorage.getItem(LEGACY_FILTER_STORE) ?? "null");
      localStorage.removeItem(LEGACY_FILTER_STORE);
      if (!v) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 예전 저장소는 마운트 뒤에만 읽을 수 있다(한 번만)
      setFiltersByType({ [type]: normalizeFilters(v.filters) });
      if (SORTS.some((x) => x.key === v.sort)) setSortByType({ [type]: v.sort });
      if (v.labelMode === "total") setLabelMode("total");
    } catch {
      /* 저장소 사용 불가 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 때 한 번(그때의 유형으로)
  }, [legacyStore]);
  // 설정이 바뀔 때마다 쿠키에 저장. 처음 값도 쿠키에서 왔으므로 마운트 때 다시 써도 그대로다
  useEffect(() => {
    try {
      writeMapPrefsCookie({ type, kindByType, months, filtersByType, sortByType, labelMode, layersByType, baseMap, zoneView });
    } catch {
      /* 쿠키 사용 불가 */
    }
  }, [type, kindByType, months, filtersByType, sortByType, labelMode, layersByType, baseMap, zoneView]);
  const toggleLayer = (key: string) =>
    setLayersByType((prev) => {
      const next = new Set(prev[type as MapType] ?? recommended);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [type]: [...next] };
    });
  const resetLayers = () =>
    setLayersByType((prev) => {
      const next = { ...prev };
      delete next[type as MapType];
      return next;
    });
  const [lng0, lat0] = initialCenter;

  const loadComplex = useCallback((id: number) => {
    fetch(`/api/map/complex/${id}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => {});
  }, []);
  // 관심 부동산 선택(목록·핀): 그 유형의 거래로 바꾸고 내 단지 거래를 연다
  const focusOn = useCallback(
    (id: string | null) => {
      setFocusId(id);
      setSelected(null);
      setDetail(null);
      const it = items.find((i) => i.id === id);
      if (!it) return;
      setSheet((v) => (v === "peek" ? "half" : v));
      setSideOpen(true);
      const tx = txOf(it);
      if (tx && TYPE_OPTIONS.some((o) => o.key === tx)) setType(tx);
      if (it.complex_id) loadComplex(it.complex_id);
    },
    [items, loadComplex],
  );
  // 지도 생성 effect 안에서 만든 핀이 최신 focusOn 을 부르도록
  const onPinClick = useEffectEvent((id: string) => focusOn(id));
  // 지도 생성: 네이버 우선, 스크립트 오류·인증 실패·시간 초과면 대체 지도로 바꾼다
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let cancelled = false;
    let handle: MapHandle | null = null;
    const fallback = (msg: string) => {
      if (cancelled) return;
      setNotice(msg);
      setEngine("leaflet");
    };
    const origin = window.location.origin;
    (async () => {
      try {
        if (engine === "naver" && keyId) {
          await loadNaver(keyId, () =>
            fallback(
              `네이버 지도 인증에 실패했습니다. 네이버 클라우드 콘솔 › Maps › Application 에서 Dynamic Map 을 선택했는지, Web 서비스 URL 에 ${origin} 이 등록돼 있는지 확인하세요. 지금은 대체 지도를 표시합니다.`,
            ),
          );
          if (cancelled) return;
          handle = createNaverMap(node, [lng0, lat0], 15);
        } else {
          const L = await loadLeaflet();
          if (cancelled) return;
          handle = createLeafletMap(
            L,
            node,
            [lng0, lat0],
            15,
            tileSources(vworldKey),
            (from, to) =>
              setNotice(`배경지도(${from.url.includes("vworld") ? "브이월드" : "기본"})를 불러오지 못해 ${to.url.includes("openstreetmap") ? "OpenStreetMap" : "다른 배경"}으로 바꿨습니다. 브이월드 키의 서비스 URL 에 ${origin} 이 등록돼 있는지 확인하세요.`),
            satelliteSources(vworldKey),
          );
        }
      } catch {
        if (engine === "naver") fallback("네이버 지도 스크립트를 불러오지 못했습니다(네트워크·광고 차단 확장 등). 대체 지도를 표시합니다.");
        else {
          setNotice("지도를 불러오지 못했습니다. 아래 목록에서 관심 부동산 주변 거래를 볼 수 있습니다.");
          setBbox([lng0 - 0.05, lat0 - 0.04, lng0 + 0.05, lat0 + 0.04]);
        }
        return;
      }
      const map = handle;
      mapRef.current = map;

      // 관심 부동산 핀(누르면 선택 → 옆 목록에 요약·주변 거래)
      for (const it of items) {
        const price = it.estimate ?? it.last_price;
        map.addHtmlMarker({
          lng: it.lng,
          lat: it.lat,
          zIndex: 1000,
          title: it.label,
          onClick: () => onPinClick(it.id),
          html: `<div style="transform:translate(-12px,-50%);display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:999px;background:#2563eb;color:#fff;font-size:13px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap;cursor:pointer">★ ${escapeHtml(pinLabel(it.label, 14))}${price ? `<span style="font-weight:500;opacity:.9">${formatManwon(price, { short: true })}</span>` : ""}</div>`,
        });
      }
      // 청약 접수(입주 예정은 레이어로 따로)
      for (const ev of events.filter((e) => e.kind === "subscription")) {
        map.addHtmlMarker({
          lng: ev.lng,
          lat: ev.lat,
          zIndex: 500,
          title: ev.title,
          html: `<div title="${escapeHtml(ev.title)}" style="transform:translate(-10px,-50%);display:inline-block;padding:4px 7px;border-radius:6px;background:#eb6834;color:#fff;font-size:12px;font-weight:600;white-space:nowrap">청약 · ${escapeHtml(ev.title.slice(0, 10))}</div>`,
        });
      }
      map.onIdle(setBbox);
      setMapVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
      handle?.destroy();
      mapRef.current = null;
      markersRef.current = [];
      layerMarkersRef.current = [];
    };
  }, [engine, keyId, vworldKey, lng0, lat0, items, events]);

  // /map?complex= 로 들어오면 그 단지 거래를 연다
  useEffect(() => {
    if (focusComplex) loadComplex(focusComplex.id);
  }, [focusComplex, loadComplex]);
  // /map?at= : 단지 없는 거래 위치 표시(실거래 좌표는 읍면동 중심일 수 있다)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !atPoint) return;
    const m = map.addHtmlMarker({
      lng: atPoint[0],
      lat: atPoint[1],
      zIndex: 950,
      title: "거래 위치(읍면동 중심일 수 있음)",
      html: `<div style="transform:translate(-50%,-100%);padding:4px 9px;border-radius:999px;background:#e8590c;color:#fff;font-size:13px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap">📍 거래 위치</div>`,
    });
    return () => m.remove();
  }, [atPoint, mapVersion]);

  // 관심 부동산 필지 경계(토지·임야·단독·상가 — 아파트는 단지 전체 필지라 라벨이 가리지 않게 뺀다)
  const boundaryPnus = useMemo(
    () => items.filter((i) => i.pnu && !["apt", "officetel"].includes(i.property_type)).map((i) => i.pnu as string),
    [items],
  );
  const [boundaries, setBoundaries] = useState<Record<string, number[][][][] | null>>({});
  useEffect(() => {
    if (!boundaryPnus.length) return;
    const ctl = new AbortController();
    fetch(`/api/parcel/boundary?pnu=${boundaryPnus.join(",")}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((d) => setBoundaries(d.boundaries ?? {}))
      .catch(() => {});
    return () => ctl.abort();
  }, [boundaryPnus]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const shapes = Object.values(boundaries)
      .filter((c): c is number[][][][] => Boolean(c))
      .map((c) => map.addPolygon({ coordinates: c, color: "#e8590c", fillOpacity: 0.1 }));
    return () => shapes.forEach((sh) => sh.remove());
  }, [boundaries, mapVersion]);

  // 모바일은 아래 시트가 지도 아래쪽 절반쯤을 가린다 — 고른 곳을 화면 가운데가 아니라 보이는 위쪽 가운데로 옮긴다.
  // zoomTo 를 주면 그 확대 단계로 바꾼 뒤의 화면 높이로 계산한다(검색으로 멀리 이동할 때)
  const bboxRef = useRef<BBox | null>(null);
  useEffect(() => {
    bboxRef.current = bbox;
  }, [bbox]);
  const moveTo = useCallback((lng: number, lat: number, zoomTo?: number) => {
    const map = mapRef.current;
    if (!map) return;
    const b = bboxRef.current;
    const z = zoomTo ?? map.zoom();
    const shift = b && !window.matchMedia("(min-width: 1024px)").matches ? (b[3] - b[1]) * 0.22 * 2 ** (map.zoom() - z) : 0;
    if (zoomTo === undefined) map.panTo(lng, lat - shift);
    else map.setCenter(lng, lat - shift, zoomTo);
  }, []);

  // 고른 관심 부동산: 탐색 반경을 그리고 그 위치로 이동, 단지가 있으면 그 단지 거래를 연다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const c = map.addCircle({ lng: focus.lng, lat: focus.lat, radius: focus.radius_m, color: "#2563eb" });
    moveTo(focus.lng, focus.lat);
    return () => c.remove();
  }, [focus, mapVersion, moveTo]);
  // /map?item= 으로 들어오면 그 단지 거래를 연다
  useEffect(() => {
    const it = items.find((i) => i.id === focusItemId);
    if (it?.complex_id) loadComplex(it.complex_id);
  }, [focusItemId, items, loadComplex]);
  const myComplexes = useMemo(() => new Set(items.map((i) => i.complex_id).filter((x): x is number => x !== null)), [items]);

  // 영역·필터 변경 시 집계 조회
  useEffect(() => {
    if (!bbox) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      const fq = filtersToQuery(filters);
      setSearching(true);
      setSearchError(null);
      fetch(`/api/map/points?bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&type=${type}&kind=${effKind}&months=${months}${fq ? `&${fq}` : ""}`, { signal: ctl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => {
          setPoints(d.points ?? []);
          setTruncated(Boolean(d.truncated));
          setSearching(false);
        })
        .catch((e) => {
          if (ctl.signal.aborted) return; // 다음 조회로 넘어감
          console.error("[map] points", e);
          setSearching(false);
          setSearchError("이 화면의 거래를 불러오지 못했습니다.");
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [bbox, type, effKind, months, filters, retry]);

  // 화면 안 단지 입지 점수 즉석 채우기(확대 LOC_ZOOM 이상, 지도가 멈추고 0.6초 뒤, 가운데에 가까운 순).
  // 지도를 다시 움직이면 요청을 끊는다(서버도 남은 계산을 멈춘다). 한도 때문에 남은 단지(pending)는 조금 뒤 다시 묻는다.
  const locAsked = useRef(new Set<number>());
  const locRounds = useRef({ key: "", n: 0 });
  const [locRound, setLocRound] = useState(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bbox || map.zoom() < LOC_ZOOM || !COMPLEX_TYPES.has(type)) return;
    const key = bbox.map((v) => v.toFixed(4)).join(",");
    if (locRounds.current.key !== key) locRounds.current = { key, n: 0 };
    if (locRounds.current.n >= LOC_ROUNDS) return;
    const [cx, cy] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    const ids = rawPoints
      .filter(
        (p) =>
          p.complex_id !== null &&
          p.loc_score === null &&
          !locRef.current[p.complex_id] &&
          !locAsked.current.has(p.complex_id) &&
          p.lng >= bbox[0] && p.lng <= bbox[2] && p.lat >= bbox[1] && p.lat <= bbox[3],
      )
      .sort((a, b) => (a.lng - cx) ** 2 + (a.lat - cy) ** 2 - ((b.lng - cx) ** 2 + (b.lat - cy) ** 2))
      .slice(0, LOC_BATCH)
      .map((p) => p.complex_id as number);
    if (!ids.length) return;
    const ctl = new AbortController();
    let again: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      locRounds.current.n++;
      ids.forEach((id) => locAsked.current.add(id));
      fetch(`/api/map/location?ids=${ids.join(",")}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: { scores: Record<number, LocSummary>; pending: number[] }) => {
          setLocCache((prev) => ({ ...prev, ...d.scores }));
          d.pending.forEach((id) => locAsked.current.delete(id));
          if (d.pending.length) again = setTimeout(() => setLocRound((x) => x + 1), 1500);
        })
        .catch(() => {
          // 끊겼거나 실패: 다음에 다시 물을 수 있게
          ids.forEach((id) => locAsked.current.delete(id));
        });
    }, 600);
    return () => {
      clearTimeout(t);
      clearTimeout(again);
      ctl.abort();
    };
  }, [rawPoints, bbox, type, locRound]);

  const select = useCallback((p: MapPoint, pan = true) => {
    setSelected(p);
    setDetail(null);
    setSheet((v) => (v === "peek" ? "half" : v));
    setSideOpen(true);
    if (p.complex_id) {
      fetch(`/api/map/complex/${p.complex_id}`)
        .then((r) => r.json())
        .then(setDetail)
        .catch(() => {});
    }
    if (pan) moveTo(p.lng, p.lat);
  }, [moveTo]);

  // 가격 라벨 마커
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markersRef.current) m.remove();
    // 거래 많은 단지부터 놓고 겹치는 라벨은 뺀다(목록에는 모두 남는다). 내 단지·선택한 단지는 항상 보인다
    const shown = declutter(
      sortPoints(points, sortKey),
      bbox,
      map.size(),
      { w: 112, h: 42, keep: (p) => selected?.key === p.key || (p.complex_id !== null && myComplexes.has(p.complex_id)) },
    );
    markersRef.current = shown.map((p) => {
      const main = mainLabel(p, effKind, labelMode, unit);
      const active = selected?.key === p.key;
      const mine = p.complex_id !== null && myComplexes.has(p.complex_id);
      // 지분거래가 많은 동네(토지)는 건수 옆에 경고 — 기획부동산 판매가 시세를 끌어올렸을 수 있다
      const sub = metricText(p, sortKey) ?? `${p.n}건${p.share_ratio != null && p.share_ratio >= SHARE_WARN ? ` · ⚠지분 ${Math.round(p.share_ratio * 100)}%` : ""}`;
      return map.addHtmlMarker({
        lng: p.lng,
        lat: p.lat,
        zIndex: active ? 900 : 100,
        onClick: () => select(p),
        html: `<div style="position:relative;transform:translate(-50%,-100%);display:inline-flex;flex-direction:column;align-items:center;padding:4px 8px;border-radius:9px;background:${active ? "#16191f" : "#ffffff"};color:${active ? "#fff" : "#16191f"};border:${mine ? "2px solid #2563eb" : "1px solid rgba(0,0,0,.12)"};box-shadow:0 1px 4px rgba(0,0,0,.18);font-size:13px;line-height:1.3;white-space:nowrap;font-weight:600;cursor:pointer"><span>${mine ? "★ " : ""}${changeArrow(p.change_1y)}${main}</span><span style="font-weight:400;font-size:12px;opacity:.75">${escapeHtml(shortName(p.name))} · ${escapeHtml(sub)}</span>${p.talk ? `<span title="최근 7일 동네 이야기 새 글" style="position:absolute;top:-7px;right:-7px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#f97316;color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:700">${p.talk > 9 ? "9+" : p.talk}</span>` : ""}</div>`,
      });
    });
  }, [points, selected, select, mapVersion, unit, myComplexes, bbox, sortKey, labelMode, effKind]);

  // POI 레이어 조회(수집된 시설 + 없으면 OpenStreetMap 에서 보충)
  useEffect(() => {
    const cats = [...layers].filter((l) => POI_LAYERS.has(l));
    if (!bbox || !cats.length) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/map/pois?bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&cats=${cats.join(",")}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d) => {
          setPois(d.pois ?? []);
          setPoiNote(d.note ?? null);
        })
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [bbox, layers]);

  // 배경 지도·교통정보
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.setBaseMap(baseMap) && baseMap !== "normal") setNotice("이 지도에서는 지형 배경을 지원하지 않습니다.");
  }, [baseMap, mapVersion]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const on = layers.has("traffic");
    if (!map.setTraffic(on) && on) setNotice("실시간 교통정보는 네이버 지도에서만 볼 수 있습니다.");
  }, [layers, mapVersion]);

  // 현재 위치: 파란 점 + 정확도 원, 그 위치로 이동
  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setNotice("이 브라우저는 위치 확인을 지원하지 않습니다.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const map = mapRef.current;
        if (!map) return;
        const { longitude: lng, latitude: lat, accuracy } = pos.coords;
        meRef.current.forEach((m) => m.remove());
        meRef.current = [
          map.addCircle({ lng, lat, radius: Math.min(accuracy, 2000), color: "#2563eb" }),
          map.addHtmlMarker({
            lng,
            lat,
            zIndex: 2000,
            title: "현재 위치",
            html: `<div style="transform:translate(-50%,-50%);width:16px;height:16px;border-radius:999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,.25),0 1px 4px rgba(0,0,0,.3)"></div>`,
          }),
        ];
        map.setCenter(lng, lat, Math.max(map.zoom(), 15));
      },
      (err) => {
        setLocating(false);
        setNotice(err.code === err.PERMISSION_DENIED ? "위치 권한이 거부됐습니다. 브라우저 설정에서 이 사이트의 위치 권한을 허용하세요." : "현재 위치를 확인하지 못했습니다.");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  // 내 부동산 보기: 가까운 것끼리(40km, 서울↔수원 정도) 묶어 한 묶음씩 맞춘다 — 멀리 떨어진 부동산까지 한 화면에 넣으면 전국 지도가 된다.
  // 처음에는 지금 화면에서 가장 가까운 묶음, 다시 누르면 다음 지역으로
  const itemClusters = useMemo(() => clusterByDistance(items, 40), [items]);
  const clusterIdx = useRef(-1);
  const fitItems = useCallback(() => {
    const map = mapRef.current;
    if (!map || !itemClusters.length) return;
    let i = (clusterIdx.current + 1) % itemClusters.length;
    if (clusterIdx.current < 0 && bbox) {
      const c = { lng: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
      const near = (g: MapWatchItem[]) => Math.min(...g.map((it) => distanceKm(it, c)));
      i = itemClusters.reduce((best, g, k) => (near(g) < near(itemClusters[best]) ? k : best), 0);
    }
    clusterIdx.current = i;
    const g = itemClusters[i];
    if (g.length === 1) {
      map.setCenter(g[0].lng, g[0].lat, 15);
      return;
    }
    const xs = g.map((it) => it.lng);
    const ys = g.map((it) => it.lat);
    map.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }, [itemClusters, bbox]);

  // 개발사업 점: 레이어가 켜져 있을 때 화면 안만 받는다(예전에는 페이지가 전국 사업을 한꺼번에 내려보냈다)
  const [projects, setProjects] = useState<MapProject[]>([]);
  const projectLayers = [layers.has("zones") ? "zones" : null, layers.has("infra") ? "infra" : null].filter(Boolean).join(",");
  useEffect(() => {
    if (!bbox || !projectLayers) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/map/projects?bbox=${bbox.map((v) => v.toFixed(4)).join(",")}&layers=${projectLayers}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { projects: MapProject[] } | null) => d && setProjects(d.projects))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [bbox, projectLayers]);

  // 개발사업·POI 마커
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of layerMarkersRef.current) m.remove();
    const ms: Removable[] = [];
    if (layers.has("zones") || layers.has("infra")) {
      // 서울 정비구역만 해도 천 곳 가까이라 화면 안만 그리고, 넓게 보거나 많으면 단계 색 점으로
      // 계획 도로는 수가 많아 확대(15단계 이상)했을 때만 점을 찍는다(부지 면은 덮개로 그린다)
      const wanted = projects.filter((p) =>
        p.type === "zone" ? layers.has("zones") && zoneShown(p.kind, p.step) : layers.has("infra") && (p.kind !== "road" || map.zoom() >= 15),
      );
      const inView = bbox ? wanted.filter((p) => p.lng >= bbox[0] && p.lng <= bbox[2] && p.lat >= bbox[1] && p.lat <= bbox[3]) : wanted;
      const compact = map.zoom() < 15 || inView.length > 60;
      for (const p of inView.slice(0, 400)) {
        const color = p.type === "zone" ? PHASE_COLOR[zonePhase(p.step) ?? "none"] : p.kind === "road" || p.kind === "ic" ? "#a05a00" : "#16191f";
        const icon = p.type === "zone" ? "🏗" : p.kind === "road" || p.kind === "ic" ? "🛣" : "🚉";
        const label = p.type === "zone" ? `${p.kind} · ${p.status ?? ""}` : `${p.status ?? ""}${p.expected_open ? ` ${p.expected_open.slice(0, 4)}` : ""}`;
        ms.push(
          map.addHtmlMarker({
            lng: p.lng,
            lat: p.lat,
            zIndex: 300,
            title: `${p.name} · ${label}`,
            onClick: () => {
              setPoiInfo(null);
              setProjectInfo(p);
            },
            html: compact
              ? `<div style="transform:translate(-50%,-50%);width:20px;height:20px;border-radius:6px;background:${color};color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${p.type === "zone" ? (p.step ?? "") : icon}</div>`
              : `<div style="transform:translate(-50%,-50%);display:inline-block;padding:4px 7px;border-radius:6px;background:${color};color:#fff;font-size:12px;white-space:nowrap">${icon} ${escapeHtml(p.name.slice(0, 14))}<br><span style="opacity:.8">${escapeHtml(label)}</span></div>`,
          }),
        );
      }
    }
    for (const p of pois.filter((x) => layers.has(x.category))) {
      const st = POI_STYLE[p.category];
      if (!st) continue;
      ms.push(
        map.addHtmlMarker({
          lng: p.lng,
          lat: p.lat,
          zIndex: 50,
          title: p.name,
          onClick: () => {
            setProjectInfo(null);
            setPoiInfo(p);
          },
          html: `<div title="${escapeHtml(p.name)}" style="transform:translate(-50%,-50%);width:26px;height:26px;border-radius:999px;background:${st.bg};display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${st.icon}</div>`,
        }),
      );
    }
    layerMarkersRef.current = ms;
  }, [layers, projects, pois, bbox, mapVersion, zoneShown]);

  // 입주 예정 레이어
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layers.has("movein")) return;
    const ms = events
      .filter((e) => e.kind === "move_in")
      .map((ev) =>
        map.addHtmlMarker({
          lng: ev.lng,
          lat: ev.lat,
          zIndex: 400,
          title: ev.title,
          html: `<div title="${escapeHtml(ev.title)}" style="transform:translate(-50%,-50%);display:inline-block;padding:4px 7px;border-radius:6px;background:#1baf7a;color:#fff;font-size:12px;white-space:nowrap">🏠 ${ev.starts_on ? `${ev.starts_on.slice(2, 4)}.${ev.starts_on.slice(5, 7)}` : ""} 입주${ev.households ? ` · ${ev.households.toLocaleString()}세대` : ""}<br><span style="opacity:.85">${escapeHtml(ev.title.replace(/ 입주 예정$/, "").slice(0, 14))}</span></div>`,
        }),
      );
    return () => ms.forEach((m) => m.remove());
  }, [layers, events, mapVersion]);

  const cadastralHinted = useRef(false);
  // 지적도·용도지역: 화면이 멈출 때마다 현재 범위 이미지 한 장(WMS). 네이버는 지적도를 자체 레이어로
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bbox) return;
    const overlays: Removable[] = [];
    const want = (k: string) => layers.has(k);
    const nativeCadastral = map.setCadastral(want("cadastral"));
    const { width, height } = map.size();
    const needVworld = (want("zoning") || (want("cadastral") && !nativeCadastral));
    if (needVworld && !vworldKey) {
      setNotice("용도지역·지적도 레이어는 브이월드 키(VWORLD_KEY)가 필요합니다.");
      return () => void map.setCadastral(false);
    }
    if (want("zoning") && vworldKey) {
      overlays.push(map.addImageOverlay({ url: vworldWmsUrl({ key: vworldKey, domain: vworldDomain, layers: ZONING_LAYERS, bbox, width, height }), bbox, opacity: 0.45 }));
    }
    if (want("cadastral") && !nativeCadastral && vworldKey) {
      if (map.zoom() >= 16) {
        overlays.push(map.addImageOverlay({ url: vworldWmsUrl({ key: vworldKey, domain: vworldDomain, layers: CADASTRAL_LAYERS, bbox, width, height }), bbox, opacity: 0.8 }));
      } else if (!cadastralHinted.current) {
        // 토지는 지적도가 기본으로 켜져 있어, 지도를 움직일 때마다 띄우지 않고 한 번만 알린다
        cadastralHinted.current = true;
        setNotice("지적도는 더 확대하면(16단계 이상) 보입니다.");
      }
    }
    return () => {
      overlays.forEach((o) => o.remove());
    };
  }, [layers, bbox, vworldKey, vworldDomain, mapVersion]);

  // 정비구역 경계·노선(개발사업 레이어)과 규제 구역: 화면이 멈출 때마다 그 범위만 받아 그린다
  useEffect(() => {
    const map = mapRef.current;
    const want = [
      layers.has("zones") ? "zones" : null,
      layers.has("infra") ? "rail" : null,
      layers.has("permit") ? "permit" : null,
      layers.has("district_plan") ? "district_plan" : null,
    ].filter(Boolean);
    if (!map || !bbox || !want.length) return;
    const ctrl = new AbortController();
    const drawn: Removable[] = [];
    fetch(`/api/map/overlays?bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&layers=${want.join(",")}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<MapOverlays & { tooWide?: boolean }>) : null))
      .then((o) => {
        if (!o || ctrl.signal.aborted) return;
        for (const r of o.regulations) {
          drawn.push(map.addPolygon({ coordinates: r.coordinates, color: r.kind === "permit" ? "#d9480f" : "#0b7285", weight: 1.5, fillOpacity: r.kind === "permit" ? 0.08 : 0.05, zIndex: 8 }));
        }
        for (const z of o.zones) {
          if (!zoneShown(z.kind, z.step)) continue;
          drawn.push(map.addPolygon({ coordinates: z.coordinates, color: PHASE_COLOR[zonePhase(z.step) ?? "none"], weight: 1.5, fillOpacity: 0.15, zIndex: 12 }));
        }
        for (const r of o.roads ?? []) {
          // 계획 도로 부지: 미집행 주황, 부분집행 갈색
          drawn.push(map.addPolygon({ coordinates: r.coordinates, color: r.status === "부분집행" ? "#a16207" : "#ea580c", weight: 1, fillOpacity: 0.35, zIndex: 10 }));
        }
        for (const l of o.rails) {
          // 철도 보라·도로 갈색, 개통 전은 점선
          const open = l.status === "개통";
          drawn.push(map.addPolyline({ coordinates: l.coordinates, color: l.kind === "road" ? (open ? "#7a5a3a" : "#c2410c") : open ? "#495057" : "#7048e8", weight: l.kind === "road" ? 4 : 3, dashed: !open }));
        }
      })
      .catch(() => {});
    return () => {
      ctrl.abort();
      drawn.forEach((d) => d.remove());
    };
  }, [layers, bbox, mapVersion, zoneShown]);

  // 개발·테마에서 골라 들어온 구역: 정보 카드가 그 구역인 동안 경계를 굵게 강조
  const focusShape = useMemo(() => {
    try {
      return focusProject?.shape ? ((JSON.parse(focusProject.shape) as { coordinates: number[][][][] }).coordinates ?? null) : null;
    } catch {
      return null;
    }
  }, [focusProject]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusShape || !focusProject || projectInfo?.id !== focusProject.id || projectInfo.type !== focusProject.type) return;
    const sh = map.addPolygon({ coordinates: focusShape, color: "#e8590c", weight: 3, fillOpacity: 0.12, zIndex: 20 });
    return () => sh.remove();
  }, [focusShape, focusProject, projectInfo, mapVersion]);

  // 지적도를 끄면 네이버 자체 레이어도 끈다
  useEffect(() => {
    if (!layers.has("cadastral")) mapRef.current?.setCadastral(false);
  }, [layers]);

  const sorted = useMemo(() => sortPoints(points, sortKey), [points, sortKey]);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreen !== "off") {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setFullscreen("off");
      setSideOpen(true);
      return;
    }
    // 전체 화면에서는 지도를 넓게: 목록은 접어 두고 버튼(데스크톱)·시트(모바일)로 연다
    setSideOpen(false);
    setSheet("peek");
    const node = rootRef.current;
    if (node?.requestFullscreen && document.fullscreenEnabled) {
      try {
        await node.requestFullscreen();
        setFullscreen("native");
        return;
      } catch {
        /* 거부되면 고정 배치로 */
      }
    }
    setFullscreen("css");
  }, [fullscreen]);
  // PC 트랙패드 핀치(ctrl+휠)·iOS Safari 제스처가 지도 밖(카드·패널·목록)에서 일어나면 브라우저가 페이지 전체를 확대한다 — 막는다.
  // 지도 캔버스 안에서는 지도 엔진이 확대로 처리한다
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const outsideMap = (e: Event) => !(e.target instanceof Element && e.target.closest(".map-canvas"));
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey && outsideMap(e)) e.preventDefault();
    };
    const onGesture = (e: Event) => {
      if (outsideMap(e)) e.preventDefault();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("gesturestart", onGesture);
    root.addEventListener("gesturechange", onGesture);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("gesturestart", onGesture);
      root.removeEventListener("gesturechange", onGesture);
    };
  }, []);
  // Esc·브라우저 버튼으로 전체 화면이 풀리면 상태도 맞춘다
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) {
        setFullscreen((v) => (v === "native" ? "off" : v));
        setSideOpen(true);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (fullscreen !== "css") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFullscreen("off");
        setSideOpen(true);
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);
  const isFull = fullscreen !== "off";

  // 검색·링크로 고른 단지는 집계가 오면 그 값(거래 수·중위·지표)으로 보여 준다
  const sel = selected ? (points.find((p) => p.key === selected.key) ?? selected) : null;
  // 고른 단지의 입지(항목별 막대까지): 확대 단계와 상관없이 바로 묻는다
  const selCid = sel?.complex_id ?? null;
  const [locFailed, setLocFailed] = useState<Record<number, true>>({});
  useEffect(() => {
    if (selCid === null || locRef.current[selCid]) return;
    const ctl = new AbortController();
    fetch(`/api/map/location?ids=${selCid}&priority=1`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { scores: Record<number, LocSummary> }) => {
        if (d.scores[selCid]) setLocCache((prev) => ({ ...prev, ...d.scores }));
        else setLocFailed((prev) => ({ ...prev, [selCid]: true }));
      })
      .catch(() => {
        if (!ctl.signal.aborted) setLocFailed((prev) => ({ ...prev, [selCid]: true }));
      });
    return () => ctl.abort();
  }, [selCid]);
  const selLoc = selCid !== null ? locCache[selCid] : undefined;
  // 고른 읍면동(단독·토지·상가): 그 동네 거래·세부 유형별 요약. 유형을 바꾸면 같은 동네의 그 유형으로 다시 받는다
  const selLawd = sel?.kind === "region" ? (sel.lawd_cd ?? null) : null;
  const [region, setRegion] = useState<{ key: string; data: RegionMarket | null } | null>(null);
  const regionKey = selLawd && isRegionType(type) ? `${selLawd}:${type}` : null;
  useEffect(() => {
    if (!regionKey) return;
    const [lawd, t] = regionKey.split(":");
    const ctl = new AbortController();
    fetch(`/api/map/region/${lawd}?type=${t}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: RegionMarket) => setRegion({ key: regionKey, data: d }))
      .catch(() => {
        if (!ctl.signal.aborted) setRegion({ key: regionKey, data: null });
      });
    return () => ctl.abort();
  }, [regionKey]);
  const regionData = region && region.key === regionKey ? region : null;

  // 검색 결과로 이동: 단지면 그 유형으로 바꾸고 단지를 연다, 동네·주소면 그 위치로
  const onSearchPick = useCallback(
    (r: MapSearchResult) => {
      const map = mapRef.current;
      if (r.kind === "place") {
        map?.setCenter(r.lng, r.lat, 15);
        return;
      }
      if (TYPE_OPTIONS.some((o) => o.key === r.property_type)) setType(r.property_type);
      setFocusId(null);
      if (map) moveTo(r.lng, r.lat, Math.max(map.zoom(), 16));
      select(stubPoint(r), false);
    },
    [select, moveTo],
  );

  // 모바일 시트 끌기: 머리(손잡이·제목 줄)를 위아래로 끌면 높이가 따라오고, 놓으면 끈 방향의 다음 단계로. 그냥 누르면 접기/펴기
  const areaRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  const onSheetDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button,a,select,input") || window.matchMedia("(min-width: 1024px)").matches) return;
    drag.current = { y: e.clientY, h: sheetRef.current?.offsetHeight ?? 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSheetMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    setDragH(Math.min((areaRef.current?.clientHeight ?? 600) - 8, Math.max(48, d.h - dy)));
  };
  const onSheetUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    setDragH(null);
    if (!d.moved) {
      setSheet((v) => (v === "peek" ? "half" : v === "half" ? "peek" : "half"));
      return;
    }
    const dy = e.clientY - d.y;
    const max = areaRef.current?.clientHeight ?? 600;
    const i = SHEET_ORDER.indexOf(sheet);
    const step = Math.abs(dy) > max * 0.4 ? 2 : Math.abs(dy) > 40 ? 1 : 0;
    setSheet(SHEET_ORDER[Math.max(0, Math.min(2, i + (dy < 0 ? step : -step)))]);
  };
  // 지도 위 패널(레이어·내 부동산)을 열면 시트는 내려 둔다
  const openOverlay = (which: "layer" | "mine") => {
    setLayerOpen((v) => (which === "layer" ? !v : false));
    setMineOpen((v) => (which === "mine" ? !v : false));
    setSheet("peek");
  };
  const clusterCount = itemClusters.length;
  // 시트 바로 위에 붙는 지도 위 요소들(모바일). 데스크톱은 지도 아래 모서리 기준
  const aboveSheet = "bottom-[calc(var(--sheet-h)+0.75rem)] lg:bottom-8";
  // 화면에 거래가 하나도 없고 동네 수준으로 확대했으면, 그 시군구가 아직 수집 전인지 확인한다
  const viewCenter: [number, number] | null = bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null;
  const emptyArea = Boolean(bbox && bbox[2] - bbox[0] < 0.3 && !searching && !searchError && points.length === 0 && !filterCount);

  return (
    <div
      ref={rootRef}
      className={clsx(
        // 지도 화면 위 카드·패널에서 두 손가락 확대·두 번 탭하면 지도 대신 페이지 전체(글자·카드)가 커졌다 — 페이지 확대는 막고
        // 스크롤(pan)만 둔다. 지도 확대는 지도 엔진이 터치 이벤트로 직접 처리한다
        "flex flex-col touch-pan-x touch-pan-y",
        isFull ? "fixed inset-0 z-[1000] h-dvh w-screen bg-bg" : "-mx-4 -mt-4 h-[calc(100dvh-7.5rem)] lg:mx-0 lg:mt-0 lg:h-[calc(100dvh-4rem)]",
      )}
    >
      {/* 상단: 검색 · 유형 · 매매/전세, 아래 줄에 조건 칩 */}
      <div className={clsx("relative z-[700] border-b border-border bg-surface", !isFull && "lg:rounded-t-xl lg:border")}>
        <div className="flex items-center gap-1.5 px-3 py-2 lg:px-4">
          <div className="min-w-0 flex-1 lg:max-w-sm">
            <MapSearch onPick={onSearchPick} />
          </div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="부동산 유형"
            className="h-9 shrink-0 rounded-full border border-border bg-surface pl-3 pr-2 text-sm font-semibold"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {TYPE_KINDS[type as MapType]?.length > 1 ? (
            <div role="group" aria-label="거래 유형" className="flex h-9 shrink-0 rounded-full bg-surface-2 p-0.5 text-sm">
              {TYPE_KINDS[type as MapType].map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={effKind === k}
                  onClick={() => setKind(k)}
                  className={clsx("rounded-full px-2.5 sm:px-3", effKind === k ? "bg-surface font-semibold text-text shadow-sm" : "text-muted")}
                >
                  {DEAL_KIND_LABEL[k]}
                </button>
              ))}
            </div>
          ) : (
            <span className="hidden shrink-0 text-xs text-muted sm:inline" title="토지·상가는 임대 실거래가 공개되지 않습니다">
              매매만 공개
            </span>
          )}
        </div>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onSort={setSort}
          type={type}
          unit={unit}
          kind={effKind}
          months={months}
          onMonths={setMonths}
          resultCount={sorted.length}
          truncated={truncated}
          onOpenAll={() => setFilterOpen(true)}
        />
      </div>

      <div
        ref={areaRef}
        style={{ "--sheet-h": dragH !== null ? `${dragH}px` : SHEET_H[sheet] } as React.CSSProperties}
        className={clsx("relative min-h-0 flex-1 lg:flex lg:overflow-hidden", !isFull && "lg:rounded-b-xl lg:border lg:border-t-0 lg:border-border")}
      >
        {/* 목록: 모바일은 아래 시트, 데스크톱은 왼쪽 패널 */}
        <aside
          ref={sheetRef}
          className={clsx(
            "absolute inset-x-0 bottom-0 z-[600] flex h-[var(--sheet-h)] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-surface shadow-[0_-4px_16px_rgb(0_0_0/0.12)]",
            "lg:static lg:z-auto lg:h-auto lg:w-80 lg:shrink-0 lg:rounded-none lg:border-r lg:border-t-0 lg:shadow-none",
            dragH === null && "transition-[height] duration-200",
            !sideOpen && "lg:hidden",
          )}
        >
          <div
            onPointerDown={onSheetDown}
            onPointerMove={onSheetMove}
            onPointerUp={onSheetUp}
            onPointerCancel={onSheetUp}
            className="shrink-0 cursor-grab touch-none select-none border-b border-border lg:cursor-auto lg:touch-auto lg:select-auto"
          >
            <div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-border lg:hidden" />
            <div className="flex h-12 items-center gap-2 px-4 text-sm">
              {sel ? (
                <>
                  <button type="button" aria-label="목록으로" onClick={() => setSelected(null)} className="-ml-2 shrink-0 p-2 text-muted hover:text-text">
                    <ChevronLeft size={22} />
                  </button>
                  <b className="min-w-0 flex-1 truncate">{sel.name}</b>
                  {sel.n ? (
                    <span className="tabular shrink-0 font-semibold">
                      {formatManwon(sel.median_price, { short: true })}
                      <span className="ml-1 text-xs font-normal text-muted">중위 · {sel.n}건</span>
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">
                    <b>{filterCount ? "조건 결과" : "이 화면 거래"}</b>
                    <span className="ml-1.5 tabular text-muted">
                      {sorted.length.toLocaleString()}
                      {truncated ? "+" : ""}곳
                    </span>
                    {searching ? <Loader2 size={13} className="ml-1.5 inline animate-spin text-muted" /> : null}
                  </span>
                  <select
                    value={sortKey}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    aria-label="정렬"
                    className="h-9 shrink-0 rounded-full border border-border bg-surface px-3 text-sm"
                  >
                    {typeSorts.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>
          <div className={clsx("min-h-0 flex-1 overflow-y-auto overscroll-contain", sheet === "peek" && dragH === null && "max-lg:hidden")}>
            {focus && !sel ? (
              <div className="border-b border-border bg-accent-soft/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">★ {shortAddress(focus.label)}</h3>
                    <p className="text-xs text-muted">
                      {focus.estimate ? `추정 시세 ${formatManwon(focus.estimate, { short: true })}` : ""}
                      {focus.estimate && focus.last_price ? " · " : ""}
                      {focus.last_price ? `최근 매매 ${formatManwon(focus.last_price, { short: true })}${focus.last_date ? `(${formatDate(focus.last_date)})` : ""}` : ""}
                      {!focus.estimate && !focus.last_price ? "아직 시세가 없습니다" : ""}
                      {` · 반경 ${focus.radius_m.toLocaleString()}m`}
                    </p>
                  </div>
                  <button type="button" className="shrink-0 text-muted" onClick={() => focusOn(null)} aria-label="선택 해제">
                    <X size={16} />
                  </button>
                </div>
                <div className="mt-2 flex gap-4 text-sm">
                  <Link href={`/items/${focus.id}`} className="text-accent">상세</Link>
                  <Link href={`/items/${focus.id}?tab=price#nearby`} className="text-accent">비슷한 주변 거래</Link>
                  <Link href={`/items/${focus.id}?tab=location`} className="text-accent">입지</Link>
                </div>
                {focus.complex_id && detail ? <ComplexTrades key={focus.id} trades={detail.trades} unit={unit} area={focus.area_m2} limit={6} /> : null}
              </div>
            ) : null}
            {sel ? (
              <div className="p-4 pt-3">
                <p className="text-xs text-muted">
                  {detail?.complex?.build_year ? `${detail.complex.build_year}년 준공 · ` : ""}
                  {detail?.complex?.households ? `${detail.complex.households.toLocaleString()}세대 · ` : ""}
                  {sel.n
                    ? `최근 ${months < 12 ? `${months}개월` : `${months / 12}년`} ${DEAL_KIND_LABEL[effKind]} ${sel.n}건 · ${effKind === "wolse" ? `보증금 중위 ${formatManwon(sel.median_price)}${sel.median_rent != null ? ` · 월세 ${Math.round(sel.median_rent)}만` : ""}` : `중위 ${formatManwon(sel.median_price)}`}`
                    : "최근 거래"}
                  {sel.median_ppy ? ` · ${unitPriceLabel(unit)} ${formatManwon(fromPerPyeong(sel.median_ppy, unit), { short: true })}` : ""}
                </p>
                {indicatorBits(sel, unit).length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {indicatorBits(sel, unit).map((b) => (
                      <span key={b} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                        {b}
                      </span>
                    ))}
                  </div>
                ) : null}
                {sel.complex_id ? (
                  <div className="mt-3 rounded-xl bg-surface-2/60 p-3">
                    <div className="mb-2 flex items-baseline gap-1.5">
                      <span className="text-xs text-muted">생활편의</span>
                      {selLoc?.total != null ? (
                        <>
                          <b className="tabular text-xl">{Math.round(selLoc.total)}</b>
                          <span className="text-xs text-muted">/ 100</span>
                          {selLoc.basis === "quick" ? (
                            <span className="ml-auto rounded-md bg-surface px-1.5 py-0.5 text-xs text-muted" title="역·학교·공원·병원·마트와 업무지구 거리로 낸 점수 — 학원·음식점 등은 다음 매일 수집 뒤 반영">간이</span>
                          ) : null}
                        </>
                      ) : selLoc || locFailed[sel.complex_id] ? (
                        <span className="text-xs text-muted">— 주변 시설 자료를 아직 모으지 못했어요</span>
                      ) : (
                        <Loader2 size={14} className="animate-spin self-center text-muted" aria-label="입지 점수 계산 중" />
                      )}
                    </div>
                    {selLoc?.total != null ? (
                      <LocBars cats={selLoc.cats} />
                    ) : !selLoc && !locFailed[sel.complex_id] ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2" aria-hidden>
                        {Array.from({ length: 8 }, (_, i) => (
                          <span key={i} className="h-2 animate-pulse rounded-full bg-surface" />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {sel.complex_id ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    <Link href={complexHref(sel.complex_id, complexItems)} className="rounded-full border border-border px-3.5 py-2 hover:bg-surface-2">
                      {complexItems[sel.complex_id] ? "내 부동산 상세" : "단지 상세"}
                    </Link>
                    <Link href={`/community?complex=${sel.complex_id}`} className="rounded-full border border-border px-3.5 py-2 hover:bg-surface-2">
                      이야기{detail?.talk?.total ? ` ${detail.talk.total}` : ""}
                      {detail?.talk?.recent ? <span className="ml-1 rounded-full bg-orange-500 px-1.5 text-xs font-bold text-white">N</span> : null}
                    </Link>
                    {!complexItems[sel.complex_id] ? (
                      <Link href={registerComplexHref(sel.complex_id)} className="rounded-full bg-accent px-3.5 py-2 font-medium text-white">
                        ★ 관심 등록
                      </Link>
                    ) : null}
                  </div>
                ) : null}
                {selLawd && isRegionType(type) ? (
                  <>
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {REGION_TYPE_INFO[type].label} 실거래는 지번 일부가 가려져 신고돼 단지처럼 묶을 수 없어, 읍면동 단위로 모아 보여 줍니다.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-sm">
                      <Link href={regionHref(selLawd, type)} className="rounded-full bg-accent px-3.5 py-2 font-medium text-white">
                        동네 시세 상세
                      </Link>
                      <Link href={`/community?sgg=${selLawd.slice(0, 5)}`} className="rounded-full border border-border px-3.5 py-2 hover:bg-surface-2">
                        동네 이야기
                      </Link>
                      <a href={naverLandHref(sel.name, "")} target="_blank" rel="noreferrer" className="rounded-full border border-border px-3.5 py-2 hover:bg-surface-2">
                        매물 보기
                      </a>
                      <Link href="/items/new" className="rounded-full border border-border px-3.5 py-2 hover:bg-surface-2">
                        ★ 주소로 관심 등록
                      </Link>
                    </div>
                    {regionData?.data ? (
                      <RegionTrades key={regionKey} data={regionData.data} unit={unit} kind={effKind} insights />
                    ) : regionData ? (
                      <p className="mt-3 text-sm text-muted">이 동네 거래를 불러오지 못했습니다.</p>
                    ) : (
                      <p className="mt-3 text-sm text-muted">불러오는 중…</p>
                    )}
                  </>
                ) : detail ? (
                  <ComplexTrades key={sel.key} trades={detail.trades} unit={unit} />
                ) : sel.complex_id ? (
                  <p className="mt-3 text-sm text-muted">불러오는 중…</p>
                ) : null}
              </div>
            ) : (
              <>
              {sorted.length === 0 ? <CoverageNote center={viewCenter} active={emptyArea} /> : null}
              {items.length === 0 && missingItems.length === 0 ? <MapIntro /> : null}
              <ul className={clsx("divide-y divide-border transition-opacity", searching && "opacity-50")} aria-busy={searching}>
                {filterCount ? (
                  <li className="flex items-center justify-between gap-2 bg-accent-soft/40 px-4 py-2.5 text-xs">
                    <span className="text-muted">
                      조건 {filterCount}개 적용 · {SORTS.find((x) => x.key === sortKey)?.label}
                    </span>
                    <span className="flex shrink-0 gap-3">
                      <button type="button" className="text-accent" onClick={() => setFilterOpen(true)}>
                        수정
                      </button>
                      <button type="button" className="text-muted" onClick={() => setFilters(EMPTY_FILTERS)}>
                        해제
                      </button>
                    </span>
                  </li>
                ) : null}
                {sorted.length === 0 ? (
                  <li className="p-4 text-sm text-muted">
                    {filterCount ? "이 화면에는 조건에 맞는 곳이 없습니다. 지도를 옮기거나 축소하고, 조건을 넓혀 보세요." : "이 영역에 해당 기간 거래가 없습니다."}
                  </li>
                ) : null}

                {sorted.map((p) => (
                  <li key={p.key}>
                    <button type="button" onClick={() => select(p)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {p.complex_id !== null && myComplexes.has(p.complex_id) ? <span className="text-accent">★ </span> : null}
                          {p.name}
                        </span>
                        <span className="text-xs text-muted">
                          {p.n}건 · 최근 {formatDate(p.last_date)}
                        </span>
                        {indicatorBits(p, unit).length ? <span className="block truncate text-xs text-muted">{indicatorBits(p, unit).join(" · ")}</span> : null}
                      </span>
                      <span className="tabular shrink-0 text-right text-base font-semibold">
                        {effKind === "wolse" ? mainLabel(p, "wolse", "total", unit) : formatManwon(p.median_price, { short: true })}
                        {effKind === "wolse" ? (
                          <span className="block text-xs font-normal text-muted">보증금/월세</span>
                        ) : (p.land_ppy ?? p.median_ppy) ? (
                          <span className="block text-xs font-normal text-muted">
                            {UNIT_BASIS[type]} {unitPriceLabel(unit)} {formatManwon(fromPerPyeong(p.land_ppy ?? p.median_ppy, unit), { short: true })}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              </>
            )}
          </div>
        </aside>

        <div className="absolute inset-0 lg:relative lg:min-w-0 lg:flex-1">
          {/* 네이버 지도는 컨테이너에 position:relative 를 인라인으로 넣어 absolute inset-0 을 덮어쓴다(높이 0 → 빈 화면).
              위치는 바깥 div 가 잡고, 지도는 크기만 채우는 안쪽 div 에 그린다. */}
          <div className="absolute inset-0 z-0">
            <div ref={el} className="map-canvas h-full w-full bg-surface-2" />
          </div>
          {engine === "leaflet" && !keyId && !notice ? (
            <div className={clsx("pointer-events-none absolute left-2 z-[500] rounded-md bg-surface/90 px-2 py-1 text-[0.75rem] text-muted shadow", aboveSheet)}>
              대체 지도 · NCP_MAPS_KEY_ID 를 설정하면 네이버 지도로 표시됩니다
            </div>
          ) : null}
          <div className={clsx("absolute right-2 z-[500] flex flex-col gap-2", aboveSheet, dragH === null && "transition-[bottom] duration-200", sheet === "full" && "max-lg:hidden")}>
            <MapButton label={isFull ? "전체 화면 닫기" : "전체 화면"} onClick={() => void toggleFullscreen()} active={isFull}>
              {isFull ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </MapButton>
            <MapButton label={sideOpen ? "목록 접기" : "목록 펴기"} onClick={() => setSideOpen((v) => !v)} active={sideOpen} className="max-lg:hidden">
              <List size={18} />
            </MapButton>
            <MapButton label="현재 위치" onClick={locate} busy={locating}>
              <Crosshair size={18} />
            </MapButton>
            <MapButton label="내 부동산" onClick={() => openOverlay("mine")} active={mineOpen}>
              <Star size={18} />
            </MapButton>
            <MapButton label="레이어·지도 설정" onClick={() => openOverlay("layer")} active={layerOpen} badge={layers.size || null}>
              <Layers size={18} />
            </MapButton>
          </div>
          {filterOpen ? (
            <div className="absolute inset-2 z-[650] flex flex-col lg:right-auto lg:w-96">
              <FilterPanel
                filters={filters}
                onChange={setFilters}
                onSort={setSort}
                type={type}
                unit={unit}
                kind={effKind}
                resultCount={sorted.length}
                truncated={truncated}
                onClose={() => setFilterOpen(false)}
              />
            </div>
          ) : null}
          {mineOpen ? (
            <div className={clsx("absolute right-14 z-[600] flex max-h-[calc(100%-var(--sheet-h)-1.5rem)] w-72 flex-col overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-lg lg:max-h-[80%]", aboveSheet)}>
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <b>내 부동산 {items.length + missingItems.length}</b>
                <span className="flex items-center gap-3">
                  {clusterCount ? (
                    <button type="button" className="text-xs text-accent" onClick={fitItems} title="가까운 것끼리 묶어 한 지역씩 보여 줍니다">
                      {clusterCount > 1 ? `지역별 보기(${clusterCount}곳)` : "모두 보기"}
                    </button>
                  ) : null}
                  <button type="button" aria-label="닫기" onClick={() => setMineOpen(false)} className="text-muted">
                    <X size={16} />
                  </button>
                </span>
              </div>
              <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                {items.length === 0 && missingItems.length === 0 ? (
                  <li className="p-3 text-muted">
                    관심 부동산이 없습니다. <Link href="/items/new" className="text-accent">등록하기</Link>
                  </li>
                ) : null}
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => {
                        focusOn(it.id);
                        setMineOpen(false);
                      }}
                      className={clsx("flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2", focusId === it.id && "bg-accent-soft/60")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{shortAddress(it.label)}</span>
                        <span className="text-xs text-muted">
                          {isPropertyType(it.property_type) ? PROPERTY_TYPES[it.property_type].label : it.property_type}
                          {it.group_tag in GROUP_TAGS ? ` · ${GROUP_TAGS[it.group_tag as keyof typeof GROUP_TAGS]}` : ""}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-right font-semibold">
                        {formatManwon(it.estimate ?? it.last_price, { short: true })}
                        <span className="block text-[0.75rem] font-normal text-muted">{it.estimate ? "추정 시세" : it.last_price ? "최근 매매" : "시세 없음"}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {missingItems.map((it) => (
                  <li key={it.id} className="px-3 py-2">
                    <span className="block truncate font-medium text-muted">{shortAddress(it.label)}</span>
                    <span className="text-xs text-warn">
                      위치를 찾지 못했습니다 ·{" "}
                      <Link href={`/items/${it.id}/edit`} className="text-accent">
                        주소 다시 선택
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {layerOpen ? (
            <div className={clsx("absolute right-14 z-[600] max-h-[calc(100%-var(--sheet-h)-1.5rem)] w-64 overflow-y-auto rounded-xl border border-border bg-surface p-3 text-sm shadow-lg lg:max-h-[80%]", aboveSheet)}>
              <div className="mb-2 flex items-center justify-between">
                <b>지도 설정</b>
                <button type="button" aria-label="닫기" onClick={() => setLayerOpen(false)} className="text-muted">
                  <X size={16} />
                </button>
              </div>
              <p className="mb-1 text-xs font-medium text-muted">배경 지도</p>
              <div className="mb-3 grid grid-cols-4 gap-1">
                {BASE_MAPS.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    disabled={b.key === "terrain" && engine !== "naver"}
                    onClick={() => setBaseMap(b.key)}
                    className={clsx(
                      "rounded-md border px-1 py-1 text-xs disabled:opacity-40",
                      baseMap === b.key ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted",
                    )}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              {effKind !== "wolse" ? (
                <>
                  <p className="mb-1 text-xs font-medium text-muted">가격 라벨</p>
                  <div className="mb-3 grid grid-cols-2 gap-1">
                    {(
                      [
                        ["unit", `${UNIT_BASIS[type] ?? ""} ${unitPriceLabel(unit)}`],
                        ["total", "거래가(중위)"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setLabelMode(k)}
                        className={clsx("rounded-md border px-1 py-1 text-xs", labelMode === k ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted">레이어 · {TYPE_OPTIONS.find((o) => o.key === type)?.label}에서 기억</p>
                {layersByType[type as MapType] ? (
                  <button type="button" className="shrink-0 text-xs text-accent" onClick={resetLayers}>
                    추천으로
                  </button>
                ) : null}
              </div>
              {LAYER_GROUPS.map((g) => (
                <div key={g.title} className="mb-2">
                  <p className="mb-1 text-xs font-medium text-muted">{g.title}</p>
                  {g.layers.map((l) => (
                    <label key={l.key} className="flex cursor-pointer items-center gap-2 py-0.5">
                      <input
                        type="checkbox"
                        checked={layers.has(l.key)}
                        disabled={l.key === "traffic" && engine !== "naver"}
                        onChange={() => toggleLayer(l.key)}
                      />
                      <span className={clsx(l.key === "traffic" && engine !== "naver" && "text-muted")}>{l.label}</span>
                      {recommended.includes(l.key) ? <span className="ml-auto rounded bg-accent-soft px-1 text-[0.7rem] text-accent">추천</span> : null}
                    </label>
                  )).flatMap((row, i) => (g.layers[i].key === "zones" && layers.has("zones") ? [row, <ZoneViewControls key="zone-view" value={zoneView} onChange={setZoneView} />] : g.layers[i].key === "infra" && layers.has("infra") ? [row, <InfraLegend key="infra-legend" />] : [row]))}
                </div>
              ))}
              <p className="mt-2 text-[0.75rem] text-muted">라벨의 <span className="text-up">▲</span>/<span className="text-down">▼</span> 는 1년 가격 변동(±1% 이상)입니다.</p>
              {poiNote ? <p className="mt-1 text-[0.75rem] text-muted">{poiNote}</p> : null}
            </div>
          ) : null}
          {projectInfo ? (
            <div className={clsx("absolute left-2 z-[550] max-w-[80%] rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow", aboveSheet)}>
              <div className="flex items-start gap-2">
                <span className="min-w-0">
                  <b className="block truncate">{projectInfo.name}</b>
                  <span className="text-xs text-muted">
                    {projectInfo.type === "zone" ? projectInfo.kind : INFRA_KIND[projectInfo.kind] ?? projectInfo.kind} · {projectInfo.status ?? "단계 미상"}
                    {projectInfo.type === "zone" && projectInfo.step ? ` (${projectInfo.step}/${ZONE_STAGES.length})` : ""}
                    {projectInfo.expected_open ? ` · 개통 ${projectInfo.expected_open.slice(0, 7)}` : ""}
                  </span>
                  {projectInfo.type === "zone" && projectInfo.step ? (
                    // 9단계 진행 막대(단계 묶음 색)
                    <span className="mt-1 flex gap-0.5" aria-label={`${projectInfo.step}/${ZONE_STAGES.length} 단계`}>
                      {ZONE_STAGES.map((st, i) => (
                        <span key={st} title={st} className="h-1.5 w-4 rounded-sm" style={{ background: i < projectInfo.step! ? PHASE_COLOR[zonePhase(projectInfo.step) ?? "none"] : "var(--border)" }} />
                      ))}
                    </span>
                  ) : null}
                  {projectInfo.kind === "road" ? (
                    <span className="mt-1 block text-xs text-muted">
                      도시계획 결정 도로{projectInfo.notice_date ? ` · 고시 ${projectInfo.notice_date}` : ""} · 개통 시기는 자료에 없어요
                    </span>
                  ) : (
                    <Link href={projectInfo.type === "zone" ? `/projects?zone=${projectInfo.id}` : "/projects?tab=transit"} className="mt-1 block text-xs font-semibold text-accent">
                      {projectInfo.type === "zone" ? "단계 이력·가격 효과 보기" : "교통 호재 상세 보기"}
                    </Link>
                  )}
                </span>
                <button type="button" aria-label="닫기" onClick={() => setProjectInfo(null)} className="text-muted">
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : null}
          {poiInfo ? (
            <div className={clsx("absolute left-2 z-[550] max-w-[70%] rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow", aboveSheet)}>
              <div className="flex items-start gap-2">
                <span className="min-w-0">
                  <b className="block truncate">{poiInfo.name}</b>
                  <span className="text-xs text-muted">{poiInfo.subcategory ?? ""}</span>
                </span>
                <button type="button" aria-label="닫기" onClick={() => setPoiInfo(null)} className="text-muted">
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : null}
          {searching || searchError ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-[520] flex justify-center">
              {searchError ? (
                <div role="alert" className="pointer-events-auto flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm shadow-md">
                  <span className="text-up">{searchError}</span>
                  <button type="button" className="font-semibold text-accent" onClick={() => setRetry((n) => n + 1)}>
                    현재 화면에서 다시 검색
                  </button>
                </div>
              ) : (
                <div role="status" className="flex items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1.5 text-sm text-muted shadow-md">
                  <Loader2 size={14} className="animate-spin" /> 이 화면 {filterCount ? "조건 검색" : "거래 조회"} 중…
                </div>
              )}
            </div>
          ) : null}
          {sheet === "peek" && !sel && emptyArea ? (
            <div className={clsx("absolute left-2 right-16 z-[510] lg:hidden", aboveSheet)}>
              <CoverageNote center={viewCenter} active compact />
            </div>
          ) : null}
          {notice ? (
            <div role="status" className="absolute inset-x-4 top-4 z-[500] flex items-start gap-2 rounded-lg bg-warn/95 p-2 text-sm text-white shadow lg:right-auto lg:max-w-lg">
              <span className="min-w-0 flex-1">{notice}</span>
              <button type="button" className="shrink-0 px-1 font-bold" aria-label="닫기" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MapButton({
  label,
  onClick,
  busy = false,
  active = false,
  badge = null,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  active?: boolean;
  badge?: number | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        "relative flex h-10 w-10 items-center justify-center rounded-full border border-border shadow-md",
        active ? "bg-accent text-white" : "bg-surface text-text hover:bg-surface-2",
        busy && "animate-pulse",
        className,
      )}
    >
      {children}
      {badge ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-text px-1 text-[0.75rem] font-bold leading-4 text-surface">{badge}</span> : null}
    </button>
  );
}

const INFRA_KIND: Record<string, string> = { rail: "철도", station: "역", road: "도로", ic: "IC" };

/** 정비구역 레이어 보기: 단계 묶음(색 범례 겸 켜고 끄기)·사업 종류. 준공 구역은 지도에 그리지 않는다 */
function ZoneViewControls({ value, onChange }: { value: MapPrefs["zoneView"]; onChange: (v: MapPrefs["zoneView"]) => void }) {
  const phases = ZONE_PHASES.filter((p) => p.key !== "done");
  const toggle = <T extends string>(cur: T[] | null, all: readonly T[], k: T): T[] | null => {
    const set = new Set(cur ?? all);
    if (set.has(k)) set.delete(k);
    else set.add(k);
    // 전부 켜지거나 전부 꺼지면 '전부'로(아무것도 안 보이는 상태를 만들지 않는다)
    return set.size === 0 || set.size === all.length ? null : all.filter((x) => set.has(x));
  };
  const phaseKeys = phases.map((p) => p.key);
  const kindKeys = ZONE_KINDS.map((k) => k.key);
  return (
    <div className="mb-1 ml-6 mt-0.5 space-y-1.5 rounded-md bg-surface-2/60 p-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="정비구역 단계">
        {phases.map((p) => {
          const on = !value.phases || value.phases.includes(p.key);
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              title={p.sub}
              onClick={() => onChange({ ...value, phases: toggle(value.phases, phaseKeys, p.key) })}
              className={clsx("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.75rem]", on ? "border-border bg-surface" : "border-transparent text-muted line-through opacity-60")}
            >
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PHASE_COLOR[p.key] }} />
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="정비사업 종류">
        {ZONE_KINDS.map((k) => {
          const on = !value.kinds || value.kinds.includes(k.key);
          return (
            <button
              key={k.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ ...value, kinds: toggle(value.kinds, kindKeys, k.key) })}
              className={clsx("rounded-full border px-2 py-0.5 text-[0.75rem]", on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted")}
            >
              {k.label}
            </button>
          );
        })}
      </div>
      <p className="text-[0.7rem] leading-snug text-muted">색이 진할수록 사업이 진척(초기 → 조합 → 인가 → 이주·착공). 숫자는 9단계 중 현재 단계</p>
    </div>
  );
}

/** 철도·도로 레이어 범례 */
function InfraLegend() {
  return (
    <div className="mb-1 ml-6 mt-0.5 space-y-0.5 rounded-md bg-surface-2/60 p-2 text-[0.75rem]">
      <p className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-5 border-t-2 border-dashed" style={{ borderColor: "#7048e8" }} />철도 계획·공사 <i className="ml-2 inline-block h-0.5 w-5 bg-[#495057]" />개통</p>
      <p className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm" style={{ background: "#ea580c", opacity: 0.6 }} />계획 도로(미집행) <i className="ml-2 inline-block h-2.5 w-4 rounded-sm" style={{ background: "#a16207", opacity: 0.6 }} />일부 개설</p>
      <p className="leading-snug text-muted">계획 도로는 도시계획으로 결정됐지만 아직 다 만들지 않은 폭 12m 이상 도로예요(도시계획정보 UPIS). 동네 수준으로 확대하면 보입니다.</p>
    </div>
  );
}
