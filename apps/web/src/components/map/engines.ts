"use client";

import { shortAddress } from "../../lib/format";

/*
 * 지도 엔진 어댑터. 화면(realty-map)은 이 인터페이스만 쓰고, 네이버 지도(키가 있을 때)와
 * Leaflet 대체 지도(브이월드 배경지도 → OpenStreetMap) 중 하나가 실제로 그린다.
 * 마커 HTML 은 좌상단이 좌표에 오도록 놓이므로, 가운데 정렬은 HTML 안의 transform 으로 한다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    naver?: any;
    navermap_authFailure?: () => void;
  }
}

/**
 * 지도 라벨용 단지명 줄이기. 앞에서 자르면 "자연앤자이1단지/2단지/3단지"가 모두 "자연앤자이"로 보여
 * 끝의 "N단지·N차"는 남기고 가운데를 줄인다.
 */
export function shortName(name: string, max = 9): string {
  if (name.length <= max) return name;
  const tail = name.match(/\d+(?:단지|차)$/)?.[0];
  if (tail && tail.length < max - 2) return `${name.slice(0, max - tail.length - 1)}…${tail}`;
  return `${name.slice(0, max - 1)}…`;
}

/**
 * 핀 라벨: 주소 그대로인 이름(토지·임야는 보통 주소가 이름)은 앞의 시도·시군구를 빼야 지번이 보인다.
 * "전남광주통합특별시 광양시 봉강면 조령리 산 164-13" → "봉강면 조령리 산 164-13"
 */
export function pinLabel(label: string, max = 16): string {
  const s = shortAddress(label);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * 라벨 겹침 줄이기: 중요한 순서(배열 순서)대로 화면 위치에 놓아 보고, 이미 놓인 라벨과 겹치면 뺀다.
 * 라벨은 좌표 위쪽 가운데에 w×h px 로 그린다고 본다. keep 이 참인 점(내 단지·선택한 단지)은 항상 남긴다.
 */
export function declutter<T extends { lng: number; lat: number }>(
  points: T[],
  bbox: BBox | null,
  size: { width: number; height: number },
  opts: { w?: number; h?: number; keep?: (p: T) => boolean } = {},
): T[] {
  if (!bbox || !size.width || !size.height) return points;
  const [west, south, east, north] = bbox;
  const my = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const [yN, yS] = [my(north), my(south)];
  const w = opts.w ?? 92;
  const h = opts.h ?? 32;
  const placed: [number, number][] = [];
  const out: T[] = [];
  const ordered = [...points].sort((a, b) => Number(opts.keep?.(b) ?? false) - Number(opts.keep?.(a) ?? false));
  for (const p of ordered) {
    const x = ((p.lng - west) / (east - west)) * size.width;
    const y = ((yN - my(p.lat)) / (yN - yS)) * size.height;
    const hit = placed.some(([px, py]) => Math.abs(px - x) < w && Math.abs(py - y) < h);
    if (hit && !opts.keep?.(p)) continue;
    placed.push([x, y]);
    out.push(p);
  }
  return out;
}

/** 두 좌표 사이 거리(km, 구면 근사) */
export function distanceKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * 가까운 점끼리 묶기(서로 km 안에 이어지는 점은 한 묶음). 서울·부산처럼 멀리 떨어진 부동산을 한 화면에 맞추면
 * 전국 지도가 되므로 지역별로 나눠 차례로 보여 줄 때 쓴다. 큰 묶음이 앞에 온다.
 */
export function clusterByDistance<T extends { lng: number; lat: number }>(points: T[], km: number): T[][] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) if (distanceKm(points[i], points[j]) <= km) parent[find(i)] = find(j);
  const groups = new Map<number, T[]>();
  points.forEach((p, i) => {
    const g = groups.get(find(i)) ?? [];
    g.push(p);
    groups.set(find(i), g);
  });
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

export type BBox = [number, number, number, number];
export type BaseMap = "normal" | "satellite" | "hybrid" | "terrain";
export type Removable = { remove(): void };
export type PolygonOptions = { coordinates: number[][][][]; color: string; weight?: number; fillOpacity?: number; zIndex?: number };

/** MultiPolygon 좌표의 범위 [서, 남, 동, 북] */
export function polygonBBox(coords: number[][][][]): BBox | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of coords) for (const ring of poly) for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export type HtmlMarkerOptions = { lng: number; lat: number; html: string; zIndex?: number; title?: string; onClick?: () => void };

export interface MapHandle {
  engine: "naver" | "leaflet";
  onIdle(cb: (bbox: BBox) => void): void;
  addHtmlMarker(o: HtmlMarkerOptions): Removable;
  addCircle(o: { lng: number; lat: number; radius: number; color: string }): Removable;
  /** 다각형(필지 경계 등). coordinates 는 GeoJSON MultiPolygon 좌표([경도, 위도]) */
  addPolygon(o: PolygonOptions): Removable;
  /** 선(노선 등). coordinates 는 GeoJSON LineString 좌표 */
  addPolyline(o: { coordinates: number[][]; color: string; weight?: number; dashed?: boolean }): Removable;
  panTo(lng: number, lat: number): void;
  /** 좌표로 이동하며 확대 단계 지정 */
  setCenter(lng: number, lat: number, zoom?: number): void;
  /** 범위가 한 화면에 들어오게 */
  fitBounds(b: BBox): void;
  /** 배경 지도 종류. 엔진이 지원하지 않으면 false */
  setBaseMap(kind: BaseMap): boolean;
  /** 실시간 교통정보(네이버만). 없으면 false */
  setTraffic(on: boolean): boolean;
  /** 현재 화면 크기·범위의 이미지(WMS GetMap 등)를 지도 위에 덮는다 */
  addImageOverlay(o: { url: string; bbox: BBox; opacity?: number }): Removable;
  /** 엔진 자체 지적도가 있으면 켠다(네이버 CadastralLayer). 없으면 false */
  setCadastral(on: boolean): boolean;
  size(): { width: number; height: number };
  zoom(): number;
  destroy(): void;
}

/**
 * 브이월드 WMS(1.3.0, EPSG:4326 은 위도·경도 순서) 한 장 URL.
 * 레이어: 연속지적도 lp_pa_cbnd_bubun·lp_pa_cbnd_bonbun, 용도지역 lt_c_uq111(도시)·112(관리)·113(농림)·114(자연환경보전)
 */
export function vworldWmsUrl(p: { key: string; domain?: string | null; layers: string[]; bbox: BBox; width: number; height: number }) {
  const [w, s, e, n] = p.bbox;
  const q = new URLSearchParams({
    service: "WMS",
    request: "GetMap",
    version: "1.3.0",
    layers: p.layers.join(","),
    styles: p.layers.join(","),
    crs: "EPSG:4326",
    bbox: [s, w, n, e].join(","),
    width: String(Math.min(2048, Math.round(p.width))),
    height: String(Math.min(2048, Math.round(p.height))),
    format: "image/png",
    transparent: "true",
    key: p.key,
  });
  if (p.domain) q.set("domain", p.domain);
  return `https://api.vworld.kr/req/wms?${q}`;
}

export type TileSource = { url: string; attribution: string; maxZoom: number };

/** 위성 배경: 브이월드 영상(+하이브리드 지명), 키가 없으면 Esri World Imagery */
export function satelliteSources(vworldKey: string | null): { base: TileSource; labels: TileSource | null } {
  if (vworldKey) {
    const k = encodeURIComponent(vworldKey);
    const attribution = '&copy; <a href="https://www.vworld.kr" target="_blank" rel="noreferrer">VWorld</a>';
    return {
      base: { url: `https://api.vworld.kr/req/wmts/1.0.0/${k}/Satellite/{z}/{y}/{x}.jpeg`, attribution, maxZoom: 19 },
      labels: { url: `https://api.vworld.kr/req/wmts/1.0.0/${k}/Hybrid/{z}/{y}/{x}.png`, attribution, maxZoom: 19 },
    };
  }
  return {
    base: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: "Tiles &copy; Esri",
      maxZoom: 19,
    },
    labels: null,
  };
}

const OSM: TileSource = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
  maxZoom: 19,
};

/** 대체 지도 배경: 브이월드 키가 있으면 브이월드(국내 지명·건물명이 자세함), 없거나 실패하면 OSM */
export function tileSources(vworldKey: string | null): TileSource[] {
  const list: TileSource[] = [];
  if (vworldKey) {
    list.push({
      url: `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(vworldKey)}/Base/{z}/{y}/{x}.png`,
      attribution: '&copy; <a href="https://www.vworld.kr" target="_blank" rel="noreferrer">VWorld</a>',
      maxZoom: 19,
    });
  }
  list.push(OSM);
  return list;
}

// ───────────────────────── 네이버 ─────────────────────────

let naverPromise: Promise<void> | null = null;

export class NaverAuthError extends Error {}

/**
 * 네이버 지도 스크립트 로드. 인증 실패(키 오류·서비스 URL 미등록)는 스크립트가 정상 로드된 뒤
 * window.navermap_authFailure 로만 알려 주므로 따로 받는다(onAuthFailure).
 */
export function loadNaver(keyId: string, onAuthFailure: () => void, timeoutMs = 10_000): Promise<void> {
  window.navermap_authFailure = onAuthFailure;
  if (window.naver?.maps?.Map) return Promise.resolve();
  if (!naverPromise) {
    naverPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(keyId)}`;
      s.async = true;
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      s.onload = () => {
        clearTimeout(timer);
        if (window.naver?.maps?.Map) resolve();
        else reject(new Error("naver.maps 없음"));
      };
      s.onerror = () => {
        clearTimeout(timer);
        reject(new Error("script error"));
      };
      document.head.appendChild(s);
    }).catch((e) => {
      naverPromise = null; // 다음 방문 때 다시 시도
      throw e;
    });
  }
  return naverPromise;
}

export function createNaverMap(el: HTMLElement, center: [number, number], zoom: number): MapHandle {
  const { naver } = window;
  const map = new naver.maps.Map(el, {
    center: new naver.maps.LatLng(center[1], center[0]),
    zoom,
    // 모바일은 두 손가락 확대가 익숙하고 버튼이 라벨을 가린다 — 넓은 화면에서만
    zoomControl: window.matchMedia("(min-width: 1024px)").matches,
    zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT },
    mapDataControl: false,
    scaleControl: false,
  });
  // 지도를 파괴한 뒤(인증 실패로 대체 지도 전환, 화면 이동) React 정리 함수가 마커·원을 지우면 네이버 지도가
  // TypeError(Circle.setMap … 'capitalize')를 던진다 — 파괴 뒤의 제거는 무시한다
  let alive = true;
  const safe = (fn: () => void): Removable => ({
    remove: () => {
      if (!alive) return;
      try {
        fn();
      } catch {
        /* 이미 지도에서 빠진 도형 */
      }
    },
  });
  // 목록 패널 높이가 바뀌는 등 컨테이너 크기가 변하면 다시 맞춘다
  const ro = new ResizeObserver(() => alive && map.setSize(new naver.maps.Size(el.clientWidth, el.clientHeight)));
  ro.observe(el);
  let cadastral: any = null;
  let traffic: any = null;
  return {
    engine: "naver",
    onIdle(cb) {
      const emit = () => {
        const b = map.getBounds();
        const sw = b.getSW();
        const ne = b.getNE();
        cb([sw.lng(), sw.lat(), ne.lng(), ne.lat()]);
      };
      naver.maps.Event.addListener(map, "idle", emit);
      emit();
    },
    addHtmlMarker(o) {
      const m = new naver.maps.Marker({
        map,
        position: new naver.maps.LatLng(o.lat, o.lng),
        zIndex: o.zIndex ?? 100,
        title: o.title,
        icon: { content: o.html, anchor: new naver.maps.Point(0, 0) },
      });
      if (o.onClick) naver.maps.Event.addListener(m, "click", o.onClick);
      return safe(() => m.setMap(null));
    },
    addCircle(o) {
      const c = new naver.maps.Circle({
        map,
        center: new naver.maps.LatLng(o.lat, o.lng),
        radius: o.radius,
        strokeColor: o.color,
        strokeOpacity: 0.5,
        strokeWeight: 1,
        fillColor: o.color,
        fillOpacity: 0.04,
        clickable: false,
      });
      return safe(() => c.setMap(null));
    },
    addPolygon(o) {
      // 네이버 Polygon 하나 = 바깥 고리 + 구멍들. MultiPolygon 은 조각마다 하나씩
      const shapes = o.coordinates.map(
        (poly) =>
          new naver.maps.Polygon({
            map,
            paths: poly.map((ring) => ring.map(([x, y]) => new naver.maps.LatLng(y, x))),
            strokeColor: o.color,
            strokeOpacity: 0.95,
            strokeWeight: o.weight ?? 2.5,
            fillColor: o.color,
            fillOpacity: o.fillOpacity ?? 0.12,
            clickable: false,
            zIndex: o.zIndex ?? 20,
          }),
      );
      return safe(() => shapes.forEach((p) => p.setMap(null)));
    },
    addPolyline(o) {
      const line = new naver.maps.Polyline({
        map,
        path: o.coordinates.map(([x, y]) => new naver.maps.LatLng(y, x)),
        strokeColor: o.color,
        strokeOpacity: 0.85,
        strokeWeight: o.weight ?? 3,
        strokeStyle: o.dashed ? "shortdash" : "solid",
        clickable: false,
        zIndex: 15,
      });
      return safe(() => line.setMap(null));
    },
    panTo(lng, lat) {
      map.panTo(new naver.maps.LatLng(lat, lng));
    },
    setCenter(lng, lat, zoom) {
      if (zoom) map.setZoom(zoom, false);
      map.setCenter(new naver.maps.LatLng(lat, lng));
    },
    fitBounds([w, s, e, n]) {
      map.fitBounds(new naver.maps.LatLngBounds(new naver.maps.LatLng(s, w), new naver.maps.LatLng(n, e)), { top: 40, right: 40, bottom: 40, left: 40 });
    },
    setBaseMap(kind) {
      const id = naver.maps.MapTypeId?.[kind.toUpperCase()];
      if (!id) return false;
      map.setMapTypeId(id);
      return true;
    },
    setTraffic(on) {
      if (!naver.maps.TrafficLayer) return false;
      traffic ??= new naver.maps.TrafficLayer({ interval: 300000 });
      traffic.setMap(on ? map : null);
      return true;
    },
    addImageOverlay(o) {
      const [w, s, e, n] = o.bbox;
      const g = new naver.maps.GroundOverlay(o.url, new naver.maps.LatLngBounds(new naver.maps.LatLng(s, w), new naver.maps.LatLng(n, e)), {
        opacity: o.opacity ?? 0.6,
        clickable: false,
      });
      g.setMap(map);
      return safe(() => g.setMap(null));
    },
    setCadastral(on) {
      if (!naver.maps.CadastralLayer) return false;
      cadastral ??= new naver.maps.CadastralLayer();
      cadastral.setMap(on ? map : null);
      return true;
    },
    size: () => ({ width: el.clientWidth, height: el.clientHeight }),
    zoom: () => map.getZoom(),
    destroy() {
      alive = false;
      ro.disconnect();
      cadastral?.setMap(null);
      traffic?.setMap(null);
      try {
        map.destroy();
      } catch {
        /* 인증 실패 직후에는 이미 정리돼 있을 수 있다 */
      }
      el.innerHTML = "";
    },
  };
}

// ───────────────────────── Leaflet(대체) ─────────────────────────

export type LeafletModule = typeof import("leaflet");

export async function loadLeaflet(): Promise<LeafletModule> {
  return (await import("leaflet")).default as unknown as LeafletModule;
}

/** 동기 생성(StrictMode 에서 같은 요소에 두 번 만들지 않도록 import 는 호출 쪽에서 먼저 끝낸다) */
export function createLeafletMap(
  L: LeafletModule,
  el: HTMLElement,
  center: [number, number],
  zoom: number,
  sources: TileSource[],
  onTileFallback?: (from: TileSource, to: TileSource) => void,
  satellite?: { base: TileSource; labels: TileSource | null },
): MapHandle {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([center[1], center[0]], zoom);
  L.control.zoom({ position: "topright" }).addTo(map);
  map.attributionControl.setPrefix(false);

  // 배경지도: 첫 번째 소스에서 타일이 하나도 안 뜨고 오류만 나면 다음 소스로 바꾼다(브이월드 키·도메인 불일치 등).
  let idx = 0;
  let layer: import("leaflet").TileLayer | null = null;
  const applySource = (i: number) => {
    const src = sources[i];
    let loaded = 0;
    let errors = 0;
    if (layer) layer.remove();
    layer = L.tileLayer(src.url, { attribution: src.attribution, maxZoom: src.maxZoom });
    layer.on("tileload", () => (loaded += 1));
    layer.on("tileerror", () => {
      errors += 1;
      if (loaded === 0 && errors >= 4 && idx + 1 < sources.length) {
        idx += 1;
        onTileFallback?.(src, sources[idx]);
        applySource(idx);
      }
    });
    layer.addTo(map);
  };
  applySource(0);
  let alive = true;
  const safe = (fn: () => void): Removable => ({
    remove: () => {
      if (!alive) return;
      try {
        fn();
      } catch {
        /* 이미 지도에서 빠진 도형 */
      }
    },
  });
  const ro = new ResizeObserver(() => alive && map.invalidateSize());
  ro.observe(el);

  // 위성·하이브리드: 기본 배경 위에 덮는다
  let satLayers: import("leaflet").TileLayer[] = [];
  const html = (o: HtmlMarkerOptions) =>
    L.divIcon({ html: o.html, className: "map-html-marker", iconSize: [0, 0], iconAnchor: [0, 0] });

  return {
    engine: "leaflet",
    onIdle(cb) {
      const emit = () => {
        const b = map.getBounds();
        cb([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      };
      map.on("moveend", emit);
      emit();
    },
    addHtmlMarker(o) {
      const m = L.marker([o.lat, o.lng], { icon: html(o), zIndexOffset: (o.zIndex ?? 100) * 10, title: o.title ?? "", keyboard: false });
      if (o.onClick) m.on("click", o.onClick);
      m.addTo(map);
      return safe(() => m.remove());
    },
    addCircle(o) {
      const c = L.circle([o.lat, o.lng], {
        radius: o.radius,
        color: o.color,
        opacity: 0.5,
        weight: 1,
        fillColor: o.color,
        fillOpacity: 0.04,
        interactive: false,
      }).addTo(map);
      return safe(() => c.remove());
    },
    addPolygon(o) {
      const latlngs = o.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [y, x] as [number, number])));
      const p = L.polygon(latlngs, {
        color: o.color,
        weight: o.weight ?? 2.5,
        opacity: 0.95,
        fillColor: o.color,
        fillOpacity: o.fillOpacity ?? 0.12,
        interactive: false,
      }).addTo(map);
      return safe(() => p.remove());
    },
    addPolyline(o) {
      const line = L.polyline(o.coordinates.map(([x, y]) => [y, x] as [number, number]), {
        color: o.color,
        weight: o.weight ?? 3,
        opacity: 0.85,
        dashArray: o.dashed ? "6 6" : undefined,
        interactive: false,
      }).addTo(map);
      return safe(() => line.remove());
    },
    panTo(lng, lat) {
      map.panTo([lat, lng]);
    },
    setCenter(lng, lat, zoom) {
      map.setView([lat, lng], zoom ?? map.getZoom());
    },
    fitBounds([w, s, e, n]) {
      map.fitBounds([[s, w], [n, e]], { padding: [40, 40], maxZoom: 16 });
    },
    setBaseMap(kind) {
      if (kind === "terrain") return false;
      satLayers.forEach((l) => l.remove());
      satLayers = [];
      if ((kind === "satellite" || kind === "hybrid") && satellite) {
        satLayers.push(L.tileLayer(satellite.base.url, { attribution: satellite.base.attribution, maxZoom: satellite.base.maxZoom }).addTo(map));
        if (kind === "hybrid" && satellite.labels) {
          satLayers.push(L.tileLayer(satellite.labels.url, { attribution: satellite.labels.attribution, maxZoom: satellite.labels.maxZoom }).addTo(map));
        }
      }
      return true;
    },
    setTraffic: () => false,
    addImageOverlay(o) {
      const [w, s, e, n] = o.bbox;
      const img = L.imageOverlay(o.url, [[s, w], [n, e]], { opacity: o.opacity ?? 0.6, interactive: false }).addTo(map);
      return safe(() => img.remove());
    },
    setCadastral: () => false,
    size: () => ({ width: el.clientWidth, height: el.clientHeight }),
    zoom: () => map.getZoom(),
    destroy() {
      alive = false;
      ro.disconnect();
      map.remove();
    },
  };
}
