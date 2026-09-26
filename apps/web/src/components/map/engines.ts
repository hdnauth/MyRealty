"use client";

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

export type BBox = [number, number, number, number];
export type Removable = { remove(): void };
export type HtmlMarkerOptions = { lng: number; lat: number; html: string; zIndex?: number; title?: string; onClick?: () => void };

export interface MapHandle {
  engine: "naver" | "leaflet";
  onIdle(cb: (bbox: BBox) => void): void;
  addHtmlMarker(o: HtmlMarkerOptions): Removable;
  addCircle(o: { lng: number; lat: number; radius: number; color: string }): Removable;
  panTo(lng: number, lat: number): void;
  destroy(): void;
}

export type TileSource = { url: string; attribution: string; maxZoom: number };

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
    zoomControl: true,
    zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT },
    mapDataControl: false,
    scaleControl: false,
  });
  // 목록 패널 높이가 바뀌는 등 컨테이너 크기가 변하면 다시 맞춘다
  const ro = new ResizeObserver(() => map.setSize(new naver.maps.Size(el.clientWidth, el.clientHeight)));
  ro.observe(el);
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
      return { remove: () => m.setMap(null) };
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
      return { remove: () => c.setMap(null) };
    },
    panTo(lng, lat) {
      map.panTo(new naver.maps.LatLng(lat, lng));
    },
    destroy() {
      ro.disconnect();
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
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(el);

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
      return { remove: () => m.remove() };
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
      return { remove: () => c.remove() };
    },
    panTo(lng, lat) {
      map.panTo([lat, lng]);
    },
    destroy() {
      ro.disconnect();
      map.remove();
    },
  };
}
