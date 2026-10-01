"use client";

import "leaflet/dist/leaflet.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { complexHref, type MyComplexes } from "@/lib/links";
import type { MapPoint } from "@/lib/map-filters";
import { type AreaUnit, formatManwon, fromPerPyeong } from "@/lib/format";
import { type BBox, createLeafletMap, createNaverMap, loadLeaflet, loadNaver, type MapHandle, declutter, pinLabel, polygonBBox, type Removable, shortName, tileSources } from "./engines";

export type MapKeys = { keyId: string | null; vworldKey: string | null };
type Poi = { id: number; category: string; name: string; lng: number; lat: number };

const POI_ICON: Record<string, { bg: string; icon: string }> = {
  subway: { bg: "#2a78d6", icon: "🚇" },
  school: { bg: "#1baf7a", icon: "🏫" },
};
const COMPLEX_TYPES = new Set(["apt", "officetel", "rowhouse"]);

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * 작은 지도: 위치 핀 + 탐색 반경 + 주변 단지(또는 읍면동) 최근 1년 매매 라벨 + 지하철·학교.
 * 등록 화면(위치 확인·주변 시세)과 부동산 개요(주변 한눈에)에서 쓴다. 조작은 확대·이동만.
 */
export function MiniMap({
  keys,
  center,
  radius,
  label,
  txType,
  selfComplexId = null,
  pnu = null,
  myComplexes = null,
  unit = "m2",
  height = 240,
}: {
  keys: MapKeys;
  center: [number, number];
  radius: number;
  label: string;
  /** 주변 가격 라벨 유형(apt·officetel·rowhouse·house·land·commercial) */
  txType: string;
  selfComplexId?: number | null;
  /** 필지 경계를 그릴 PNU(토지·임야는 필지 영역이 곧 부동산) */
  pnu?: string | null;
  /** 라벨을 누르면 이동: 내 관심 부동산 단지는 그 상세, 아니면 단지 상세 */
  myComplexes?: MyComplexes | null;
  unit?: AreaUnit;
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const mapRef = useRef<MapHandle | null>(null);
  const [engine, setEngine] = useState<"naver" | "leaflet">(keys.keyId ? "naver" : "leaflet");
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [version, setVersion] = useState(0);
  const [lng, lat] = center;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let cancelled = false;
    let handle: MapHandle | null = null;
    (async () => {
      try {
        if (engine === "naver" && keys.keyId) {
          await loadNaver(keys.keyId, () => !cancelled && setEngine("leaflet"));
          if (cancelled) return;
          handle = createNaverMap(node, [lng, lat], 15);
        } else {
          const L = await loadLeaflet();
          if (cancelled) return;
          handle = createLeafletMap(L, node, [lng, lat], 15, tileSources(keys.vworldKey));
        }
      } catch {
        if (engine === "naver" && !cancelled) setEngine("leaflet");
        return;
      }
      mapRef.current = handle;
      handle.onIdle(setBbox);
      setVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
      handle?.destroy();
      mapRef.current = null;
    };
  }, [engine, keys.keyId, keys.vworldKey, lng, lat]);

  // 내 위치·반경(반경을 바꾸면 원만 다시 그린다)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ms: Removable[] = [
      map.addCircle({ lng, lat, radius, color: "#2563eb" }),
      map.addHtmlMarker({
        lng,
        lat,
        zIndex: 1000,
        html: `<div style="transform:translate(-12px,-50%);display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:999px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap">★ ${esc(pinLabel(label))}</div>`,
      }),
    ];
    return () => ms.forEach((m) => m.remove());
  }, [lng, lat, radius, label, version]);

  // 필지 경계: 받아서 테두리로 그리고, 한 화면에 안 들어오면(큰 임야 등) 경계에 맞춘다
  const [loaded, setLoaded] = useState<{ pnu: string; coords: number[][][][] | null } | null>(null);
  const boundary = pnu && loaded?.pnu === pnu ? loaded.coords : null;
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!pnu) return;
    const ctl = new AbortController();
    fetch(`/api/parcel/boundary?pnu=${pnu}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((d) => setLoaded({ pnu, coords: d.boundaries?.[pnu] ?? null }))
      .catch(() => {});
    return () => ctl.abort();
  }, [pnu]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boundary) return;
    const shape = map.addPolygon({ coordinates: boundary, color: "#e8590c" });
    const pb = polygonBBox(boundary);
    const view = bbox;
    if (pb && view && fitted.current !== `${pnu}:${version}`) {
      fitted.current = `${pnu}:${version}`;
      const inside = pb[0] >= view[0] && pb[1] >= view[1] && pb[2] <= view[2] && pb[3] <= view[3];
      if (!inside) map.fitBounds(pb);
    }
    return () => shape.remove();
    // bbox 는 처음 맞출 때만 필요(움직일 때마다 다시 그리지 않도록 뺀다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary, version, pnu]);

  // 주변 거래·시설
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [pois, setPois] = useState<Poi[]>([]);
  useEffect(() => {
    if (!bbox) return;
    const ctl = new AbortController();
    const b = bbox.map((v) => v.toFixed(5)).join(",");
    const t = setTimeout(() => {
      fetch(`/api/map/points?bbox=${b}&type=${txType === "forest" ? "land" : txType}&kind=sale&months=12`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d) => setPoints(d.points ?? []))
        .catch(() => {});
      fetch(`/api/map/pois?bbox=${b}&cats=subway,school`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d) => setPois(d.pois ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [bbox, txType]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const perArea = COMPLEX_TYPES.has(txType);
    const ms: Removable[] = [];
    const shown = declutter([...points].sort((a, b) => b.n - a.n).slice(0, 60), bbox, map.size(), { w: 84, h: 30 });
    for (const p of shown) {
      // 내 단지는 핀이 이미 가리키므로 라벨을 겹쳐 그리지 않는다
      if (selfComplexId !== null && p.complex_id === selfComplexId) continue;
      const self = false;
      const main = perArea && p.median_ppy ? `${formatManwon(fromPerPyeong(p.median_ppy, unit), { short: true })}/${unit === "pyeong" ? "평" : "㎡"}` : formatManwon(p.median_price, { short: true });
      ms.push(
        map.addHtmlMarker({
          lng: p.lng,
          lat: p.lat,
          zIndex: self ? 900 : 100,
          title: `${p.name} · 최근 1년 ${p.n}건${p.complex_id ? " — 눌러서 단지 보기" : ""}`,
          onClick: p.complex_id ? () => router.push(complexHref(p.complex_id!, myComplexes)) : undefined,
          html: `<div style="transform:translate(-50%,-100%);display:inline-flex;flex-direction:column;align-items:center;padding:2px 6px;border-radius:7px;background:${self ? "#2563eb" : "#fff"};color:${self ? "#fff" : "#16191f"};border:1px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.15);font-size:10.5px;line-height:1.2;white-space:nowrap;font-weight:600;cursor:${p.complex_id ? "pointer" : "default"}">${main}<span style="font-weight:400;opacity:.75">${esc(shortName(p.name))} · ${p.n}건</span></div>`,
        }),
      );
    }
    for (const p of pois.slice(0, 80)) {
      const st = POI_ICON[p.category];
      if (!st) continue;
      ms.push(
        map.addHtmlMarker({
          lng: p.lng,
          lat: p.lat,
          zIndex: 50,
          title: p.name,
          html: `<div title="${esc(p.name)}" style="transform:translate(-50%,-50%);width:18px;height:18px;border-radius:999px;background:${st.bg};display:flex;align-items:center;justify-content:center;font-size:10px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${st.icon}</div>`,
        }),
      );
    }
    return () => ms.forEach((m) => m.remove());
  }, [points, pois, txType, selfComplexId, unit, version, bbox, router, myComplexes]);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="relative" style={{ height }}>
        <div className="absolute inset-0 z-0">
          <div ref={el} className="map-canvas h-full w-full bg-surface-2" />
        </div>
      </div>
      <p className="border-t border-border bg-surface px-3 py-1.5 text-[11px] text-muted">
        파란 원: 탐색 반경 {radius >= 1000 ? `${radius / 1000}km` : `${radius}m`} · 라벨: 주변 최근 1년 매매 중위
        {COMPLEX_TYPES.has(txType) ? `(${unit === "pyeong" ? "평" : "㎡"}당)` : ""}
        {points.length === 0 ? " — 아직 수집된 주변 거래가 없습니다" : ` ${points.length}곳`}
        {pois.length ? " · 🚇 지하철 · 🏫 학교" : ""}
        {boundary ? " · 주황 테두리: 필지 경계(연속지적도)" : ""}
      </p>
    </div>
  );
}
