"use client";

import clsx from "clsx";
import "leaflet/dist/leaflet.css";
import { ChevronLeft, Crosshair, Layers, List, Loader2, Maximize2, Minimize2, Star, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type AreaUnit, formatDate, formatManwon, formatPct, fromPerPyeong, shortAddress, unitPriceLabel } from "@/lib/format";
import { complexHref, type MyComplexes, registerComplexHref } from "@/lib/links";
import type { MapSearchResult } from "@/app/api/map/search/route";
import { activeFilterCount, COMPLEX_TYPES, EMPTY_FILTERS, type MapFilters, type MapPoint, normalizeFilters, SORTS, type SortKey, filtersToQuery, sortPoints } from "@/lib/map-filters";
import { DEAL_KIND_LABEL, GROUP_TAGS, isPropertyType, PROPERTY_TYPES } from "@/lib/property";
import { ComplexTrades, type Trade } from "./complex-trades";
import { FilterBar, FilterPanel } from "./filter-panel";
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
export type MapProject = { type: "zone" | "infra"; id: number; name: string; kind: string; status: string | null; step: number | null; expected_open: string | null; lng: number; lat: number };
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
      { key: "projects", label: "🏗 정비구역·철도/도로 사업" },
      { key: "movein", label: "🏠 입주 예정" },
    ],
  },
  {
    title: "필지 · 규제",
    layers: [
      { key: "cadastral", label: "지적도(필지 경계)" },
      { key: "zoning", label: "용도지역" },
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

const FILTER_STORE = "map-filters-v1";

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
    default:
      return null;
  }
}

/** 단지 지표 요약(목록·선택 카드) */
function indicatorBits(p: MapPoint): string[] {
  return [
    p.build_year ? `${p.build_year}년` : null,
    p.households ? `${p.households.toLocaleString()}세대` : null,
    p.jeonse_ratio !== null ? `전세가율 ${Math.round(p.jeonse_ratio * 100)}%` : null,
    p.change_1y !== null ? `1년 ${formatPct(p.change_1y, 1)}` : null,
    p.loc_score !== null ? `입지 ${Math.round(p.loc_score)}점` : null,
  ].filter((x): x is string => x !== null);
}

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
  projects = [],
  initialCenter,
  focusItemId = null,
  unit = "m2",
  missingItems = [],
  focusComplex = null,
  atPoint = null,
  initialType = null,
  complexItems = {},
}: {
  /** 처음 골라 둘 단지(/map?complex=) */
  focusComplex?: MapFocusComplex | null;
  /** 처음 표시할 위치(/map?at=경도,위도) — 단지 없는 거래 위치 */
  atPoint?: [number, number] | null;
  /** 처음 거래 유형 필터(/map?type=) */
  initialType?: string | null;
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
  projects?: MapProject[];
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
  // 관심 부동산·단지를 골라 들어오면 그 유형의 거래를 보여 준다
  const [type, setType] = useState<string>(() => {
    const t = initialType === "forest" ? "land" : initialType;
    if (t && TYPE_OPTIONS.some((o) => o.key === t)) return t;
    return txOf(items.find((i) => i.id === focusItemId)) ?? "apt";
  });
  const [kind, setKind] = useState<"sale" | "jeonse">("sale");
  const [months, setMonths] = useState(6);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [truncated, setTruncated] = useState(false);
  // 화면 이동·조건 변경마다 다시 조회한다. 진행·실패를 보여 줘야 이전 결과가 남아 있는 것과 구분된다
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // 후보 탐색 조건·정렬(이 기기에 기억)
  const [filters, setFilters] = useState<MapFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("n");
  // 라벨 큰 글씨: 단위가격(평당·㎡당) 또는 거래가(중위) — 단독·토지·상가는 늘 거래가
  const [labelMode, setLabelMode] = useState<"unit" | "total">("unit");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterCount = activeFilterCount(filters, type);
  // 유형을 바꿨는데 그 유형에 없는 정렬(입지·신축)이면 기본으로
  const sortKey: SortKey = COMPLEX_TYPES.has(type) || !SORTS.find((x) => x.key === sort)?.complexOnly ? sort : "n";
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FILTER_STORE) ?? "null");
      if (!v) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 조건은 마운트 뒤에만 읽을 수 있다
      setFilters(normalizeFilters(v.filters));
      if (SORTS.some((x) => x.key === v.sort)) setSort(v.sort);
      if (v.labelMode === "total") setLabelMode("total");
    } catch {
      /* 저장소 사용 불가 */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORE, JSON.stringify({ filters, sort, labelMode }));
    } catch {
      /* 저장소 사용 불가 */
    }
  }, [filters, sort, labelMode]);
  // 전체 화면: 브라우저 전체 화면(Fullscreen API), 안 되면(iPhone Safari 등) 화면을 덮는 고정 배치
  const [fullscreen, setFullscreen] = useState<"off" | "native" | "css">("off");
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(() => (focusComplex ? stubPoint(focusComplex) : null));
  const [detail, setDetail] = useState<{ complex: { name: string; build_year: number | null; households: number | null }; trades: Trade[]; talk?: { total: number; recent: number } } | null>(null);
  const [layers, setLayers] = useState<Set<string>>(() => new Set(["projects", "subway", "school"]));
  const [pois, setPois] = useState<MapPoi[]>([]);
  const [poiNote, setPoiNote] = useState<string | null>(null);
  const [poiInfo, setPoiInfo] = useState<MapPoi | null>(null);
  const [layerOpen, setLayerOpen] = useState(false);
  const [baseMap, setBaseMap] = useState<BaseMap>("normal");
  const [locating, setLocating] = useState(false);
  const meRef = useRef<Removable[]>([]);
  const toggleLayer = (key: string) =>
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
          html: `<div style="transform:translate(-12px,-50%);display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:999px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap;cursor:pointer">★ ${escapeHtml(pinLabel(it.label, 14))}${price ? `<span style="font-weight:500;opacity:.9">${formatManwon(price, { short: true })}</span>` : ""}</div>`,
        });
      }
      // 청약 접수(입주 예정은 레이어로 따로)
      for (const ev of events.filter((e) => e.kind === "subscription")) {
        map.addHtmlMarker({
          lng: ev.lng,
          lat: ev.lat,
          zIndex: 500,
          title: ev.title,
          html: `<div title="${escapeHtml(ev.title)}" style="transform:translate(-10px,-50%);display:inline-block;padding:3px 6px;border-radius:6px;background:#eb6834;color:#fff;font-size:11px;font-weight:600;white-space:nowrap">청약 · ${escapeHtml(ev.title.slice(0, 10))}</div>`,
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
      html: `<div style="transform:translate(-50%,-100%);padding:3px 8px;border-radius:999px;background:#e8590c;color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap">📍 거래 위치</div>`,
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
      fetch(`/api/map/points?bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&type=${type}&kind=${kind}&months=${months}${fq ? `&${fq}` : ""}`, { signal: ctl.signal })
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
  }, [bbox, type, kind, months, filters, retry]);

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
      { w: 96, h: 34, keep: (p) => selected?.key === p.key || (p.complex_id !== null && myComplexes.has(p.complex_id)) },
    );
    markersRef.current = shown.map((p) => {
      const main = labelMode === "unit" && p.median_ppy && COMPLEX_TYPES.has(type) ? `${formatManwon(fromPerPyeong(p.median_ppy, unit), { short: true })}/${unit === "pyeong" ? "평" : "㎡"}` : formatManwon(p.median_price, { short: true });
      const active = selected?.key === p.key;
      const mine = p.complex_id !== null && myComplexes.has(p.complex_id);
      const sub = metricText(p, sortKey) ?? `${p.n}건`;
      return map.addHtmlMarker({
        lng: p.lng,
        lat: p.lat,
        zIndex: active ? 900 : 100,
        onClick: () => select(p),
        html: `<div style="position:relative;transform:translate(-50%,-100%);display:inline-flex;flex-direction:column;align-items:center;padding:3px 7px;border-radius:8px;background:${active ? "#16191f" : "#ffffff"};color:${active ? "#fff" : "#16191f"};border:${mine ? "2px solid #2563eb" : "1px solid rgba(0,0,0,.12)"};box-shadow:0 1px 4px rgba(0,0,0,.18);font-size:11px;line-height:1.25;white-space:nowrap;font-weight:600;cursor:pointer"><span>${mine ? "★ " : ""}${changeArrow(p.change_1y)}${main}</span><span style="font-weight:400;opacity:.7">${escapeHtml(shortName(p.name))} · ${escapeHtml(sub)}</span>${p.talk ? `<span title="최근 7일 동네 이야기 새 글" style="position:absolute;top:-7px;right:-7px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#f97316;color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:700">${p.talk > 9 ? "9+" : p.talk}</span>` : ""}</div>`,
      });
    });
  }, [points, selected, type, select, mapVersion, unit, myComplexes, bbox, sortKey, labelMode]);

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

  // 개발사업·POI 마커
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of layerMarkersRef.current) m.remove();
    const ms: Removable[] = [];
    if (layers.has("projects")) {
      for (const p of projects) {
        const label = p.type === "zone" ? `${p.kind} · ${p.status ?? ""}` : `${p.status ?? ""}${p.expected_open ? ` ${p.expected_open.slice(0, 4)}` : ""}`;
        ms.push(
          map.addHtmlMarker({
            lng: p.lng,
            lat: p.lat,
            zIndex: 300,
            title: p.name,
            html: `<div style="transform:translate(-50%,-50%);display:inline-block;padding:3px 6px;border-radius:6px;background:${p.type === "zone" ? "#4a3aa7" : "#16191f"};color:#fff;font-size:11px;white-space:nowrap">${p.type === "zone" ? "🏗" : "🚉"} ${escapeHtml(p.name.slice(0, 14))}<br><span style="opacity:.8">${escapeHtml(label)}</span></div>`,
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
          onClick: () => setPoiInfo(p),
          html: `<div title="${escapeHtml(p.name)}" style="transform:translate(-50%,-50%);width:22px;height:22px;border-radius:999px;background:${st.bg};display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${st.icon}</div>`,
        }),
      );
    }
    layerMarkersRef.current = ms;
  }, [layers, projects, pois, mapVersion]);

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
          html: `<div title="${escapeHtml(ev.title)}" style="transform:translate(-50%,-50%);display:inline-block;padding:3px 6px;border-radius:6px;background:#1baf7a;color:#fff;font-size:11px;white-space:nowrap">🏠 ${ev.starts_on ? `${ev.starts_on.slice(2, 4)}.${ev.starts_on.slice(5, 7)}` : ""} 입주${ev.households ? ` · ${ev.households.toLocaleString()}세대` : ""}<br><span style="opacity:.85">${escapeHtml(ev.title.replace(/ 입주 예정$/, "").slice(0, 14))}</span></div>`,
        }),
      );
    return () => ms.forEach((m) => m.remove());
  }, [layers, events, mapVersion]);

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
      } else {
        setNotice("지적도는 더 확대하면(16단계 이상) 보입니다.");
      }
    }
    return () => {
      overlays.forEach((o) => o.remove());
    };
  }, [layers, bbox, vworldKey, vworldDomain, mapVersion]);

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

  return (
    <div
      ref={rootRef}
      className={clsx(
        "flex flex-col",
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
          <div role="group" aria-label="거래 유형" className="flex h-9 shrink-0 rounded-full bg-surface-2 p-0.5 text-sm">
            {(["sale", "jeonse"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={clsx("rounded-full px-3", kind === k ? "bg-surface font-semibold text-text shadow-sm" : "text-muted")}
              >
                {DEAL_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onSort={setSort}
          type={type}
          unit={unit}
          kind={kind}
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
            <div className="flex h-11 items-center gap-2 px-4 text-sm lg:h-12">
              {sel ? (
                <>
                  <button type="button" aria-label="목록으로" onClick={() => setSelected(null)} className="-ml-1.5 shrink-0 p-1 text-muted hover:text-text">
                    <ChevronLeft size={18} />
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
                    className="h-7 shrink-0 rounded-full border border-border bg-surface px-2 text-xs"
                  >
                    {SORTS.filter((x) => COMPLEX_TYPES.has(type) || !x.complexOnly).map((x) => (
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
                <div className="mt-2 flex gap-3 text-sm">
                  <Link href={`/items/${focus.id}`} className="text-accent">상세</Link>
                  <Link href={`/items/${focus.id}?tab=nearby`} className="text-accent">비슷한 주변 거래</Link>
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
                  {sel.n ? `최근 ${months < 12 ? `${months}개월` : `${months / 12}년`} ${DEAL_KIND_LABEL[kind]} ${sel.n}건 · 중위 ${formatManwon(sel.median_price)}` : "최근 거래"}
                  {sel.median_ppy ? ` · ${unitPriceLabel(unit)} ${formatManwon(fromPerPyeong(sel.median_ppy, unit), { short: true })}` : ""}
                </p>
                {indicatorBits(sel).length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {indicatorBits(sel).map((b) => (
                      <span key={b} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                        {b}
                      </span>
                    ))}
                  </div>
                ) : null}
                {sel.complex_id ? (
                  <div className="mt-2.5 flex gap-2 text-sm">
                    <Link href={complexHref(sel.complex_id, complexItems)} className="rounded-full border border-border px-3 py-1 hover:bg-surface-2">
                      {complexItems[sel.complex_id] ? "내 부동산 상세" : "단지 상세"}
                    </Link>
                    <Link href={`/community?complex=${sel.complex_id}`} className="rounded-full border border-border px-3 py-1 hover:bg-surface-2">
                      이야기{detail?.talk?.total ? ` ${detail.talk.total}` : ""}
                      {detail?.talk?.recent ? <span className="ml-1 rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white">N</span> : null}
                    </Link>
                    {!complexItems[sel.complex_id] ? (
                      <Link href={registerComplexHref(sel.complex_id)} className="rounded-full bg-accent px-3 py-1 font-medium text-white">
                        ★ 관심 등록
                      </Link>
                    ) : null}
                  </div>
                ) : null}
                {detail ? (
                  <ComplexTrades key={sel.key} trades={detail.trades} unit={unit} />
                ) : sel.complex_id ? (
                  <p className="mt-3 text-sm text-muted">불러오는 중…</p>
                ) : null}
              </div>
            ) : (
              <ul className={clsx("divide-y divide-border transition-opacity", searching && "opacity-50")} aria-busy={searching}>
                {filterCount ? (
                  <li className="flex items-center justify-between gap-2 bg-accent-soft/40 px-4 py-2 text-xs">
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
                    <button type="button" onClick={() => select(p)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {p.complex_id !== null && myComplexes.has(p.complex_id) ? <span className="text-accent">★ </span> : null}
                          {p.name}
                        </span>
                        <span className="text-xs text-muted">
                          {p.n}건 · 최근 {formatDate(p.last_date)}
                        </span>
                        {indicatorBits(p).length ? <span className="block truncate text-[11px] text-muted">{indicatorBits(p).join(" · ")}</span> : null}
                      </span>
                      <span className="tabular shrink-0 text-right text-sm font-semibold">
                        {formatManwon(p.median_price, { short: true })}
                        {p.median_ppy ? <span className="block text-[11px] font-normal text-muted">{unitPriceLabel(unit)} {formatManwon(fromPerPyeong(p.median_ppy, unit), { short: true })}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
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
            <div className={clsx("pointer-events-none absolute left-2 z-[500] rounded-md bg-surface/90 px-2 py-1 text-[11px] text-muted shadow", aboveSheet)}>
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
                kind={kind}
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
                        <span className="block text-[11px] font-normal text-muted">{it.estimate ? "추정 시세" : it.last_price ? "최근 매매" : "시세 없음"}</span>
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
              {COMPLEX_TYPES.has(type) ? (
                <>
                  <p className="mb-1 text-xs font-medium text-muted">가격 라벨</p>
                  <div className="mb-3 grid grid-cols-2 gap-1">
                    {(
                      [
                        ["unit", `${unitPriceLabel(unit)} 가격`],
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
                    </label>
                  ))}
                </div>
              ))}
              <p className="mt-2 text-[11px] text-muted">라벨의 <span className="text-up">▲</span>/<span className="text-down">▼</span> 는 1년 가격 변동(±1% 이상)입니다.</p>
              {poiNote ? <p className="mt-1 text-[11px] text-muted">{poiNote}</p> : null}
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
      {badge ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-text px-1 text-[10px] font-bold leading-4 text-surface">{badge}</span> : null}
    </button>
  );
}
