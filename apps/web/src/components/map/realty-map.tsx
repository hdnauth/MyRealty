"use client";

import clsx from "clsx";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapPoint } from "@/app/api/map/points/route";
import { type AreaUnit, formatDate, formatManwon, fromPerPyeong, unitPriceLabel } from "@/lib/format";
import { DEAL_KIND_LABEL } from "@/lib/property";
import { type BBox, createLeafletMap, createNaverMap, loadLeaflet, loadNaver, type MapHandle, type Removable, tileSources, vworldWmsUrl } from "./engines";

export type MapWatchItem = { id: string; label: string; lng: number; lat: number; radius_m: number; property_type: string };
export type MapEvent = { id: number; title: string; kind: string; lng: number; lat: number; starts_on: string | null; households: number | null };
export type MapProject = { type: "zone" | "infra"; id: number; name: string; kind: string; status: string | null; step: number | null; expected_open: string | null; lng: number; lat: number };
type MapPoi = { id: number; category: string; subcategory: string | null; name: string; lng: number; lat: number };

const LAYERS = [
  { key: "projects", label: "개발사업" },
  { key: "subway", label: "지하철" },
  { key: "school", label: "학교" },
  { key: "park", label: "공원" },
  { key: "hospital", label: "병원" },
  { key: "mart", label: "마트" },
  { key: "movein", label: "입주 예정" },
  { key: "cadastral", label: "지적도" },
  { key: "zoning", label: "용도지역" },
] as const;
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
const MONTHS = [3, 6, 12, 36];

type Trade = { id: number; deal_kind: string; deal_date: string; price: number; monthly_rent: number | null; area_m2: number | null; floor: number | null; is_canceled: boolean };

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function RealtyMap({
  keyId,
  vworldKey = null,
  vworldDomain = null,
  items,
  events,
  projects = [],
  initialCenter,
  unit = "m2",
}: {
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
  const mapRef = useRef<MapHandle | null>(null);
  const markersRef = useRef<Removable[]>([]);
  const layerMarkersRef = useRef<Removable[]>([]);
  // 지도가 새로 만들어질 때마다 올라가 마커 effect 를 다시 돌린다(네이버 → 대체 지도 전환 포함)
  const [mapVersion, setMapVersion] = useState(0);
  const [engine, setEngine] = useState<"naver" | "leaflet">(keyId ? "naver" : "leaflet");
  const [notice, setNotice] = useState<string | null>(null);
  const [type, setType] = useState("apt");
  const [kind, setKind] = useState<"sale" | "jeonse">("sale");
  const [months, setMonths] = useState(6);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [detail, setDetail] = useState<{ complex: { name: string; build_year: number | null; households: number | null }; trades: Trade[] } | null>(null);
  const [layers, setLayers] = useState<Set<string>>(() => new Set(["projects"]));
  const [pois, setPois] = useState<MapPoi[]>([]);
  const [lng0, lat0] = initialCenter;

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
          handle = createLeafletMap(L, node, [lng0, lat0], 15, tileSources(vworldKey), (from, to) =>
            setNotice(`배경지도(${from.url.includes("vworld") ? "브이월드" : "기본"})를 불러오지 못해 ${to.url.includes("openstreetmap") ? "OpenStreetMap" : "다른 배경"}으로 바꿨습니다. 브이월드 키의 서비스 URL 에 ${origin} 이 등록돼 있는지 확인하세요.`),
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

      // 관심 부동산 핀 + 탐색 반경
      for (const it of items) {
        map.addCircle({ lng: it.lng, lat: it.lat, radius: it.radius_m, color: "#2563eb" });
        map.addHtmlMarker({
          lng: it.lng,
          lat: it.lat,
          zIndex: 1000,
          html: `<a href="/items/${it.id}" style="transform:translate(-12px,-50%);display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:999px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap;text-decoration:none">★ ${escapeHtml(it.label)}</a>`,
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

  // 영역·필터 변경 시 집계 조회
  useEffect(() => {
    if (!bbox) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/map/points?bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&type=${type}&kind=${kind}&months=${months}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d) => setPoints(d.points ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [bbox, type, kind, months]);

  const select = useCallback((p: MapPoint) => {
    setSelected(p);
    setDetail(null);
    if (p.complex_id) {
      fetch(`/api/map/complex/${p.complex_id}`)
        .then((r) => r.json())
        .then(setDetail)
        .catch(() => {});
    }
    mapRef.current?.panTo(p.lng, p.lat);
  }, []);

  // 가격 라벨 마커
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = points.map((p) => {
      const main = p.median_ppy && (type === "apt" || type === "officetel" || type === "rowhouse") ? `${formatManwon(fromPerPyeong(p.median_ppy, unit), { short: true })}/${unit === "pyeong" ? "평" : "㎡"}` : formatManwon(p.median_price, { short: true });
      const active = selected?.key === p.key;
      return map.addHtmlMarker({
        lng: p.lng,
        lat: p.lat,
        zIndex: active ? 900 : 100,
        onClick: () => select(p),
        html: `<div style="transform:translate(-50%,-100%);display:inline-flex;flex-direction:column;align-items:center;padding:3px 7px;border-radius:8px;background:${active ? "#16191f" : "#ffffff"};color:${active ? "#fff" : "#16191f"};border:1px solid rgba(0,0,0,.12);box-shadow:0 1px 4px rgba(0,0,0,.18);font-size:11px;line-height:1.25;white-space:nowrap;font-weight:600;cursor:pointer">${main}<span style="font-weight:400;opacity:.7">${escapeHtml(p.name.slice(0, 8))} · ${p.n}건</span></div>`,
      });
    });
  }, [points, selected, type, select, mapVersion, unit]);

  // POI 레이어 조회
  useEffect(() => {
    const cats = [...layers].filter((l) => l !== "projects");
    if (!bbox || !cats.length) return;
    const ctl = new AbortController();
    fetch(`/api/map/pois?bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&cats=${cats.join(",")}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((d) => setPois(d.pois ?? []))
      .catch(() => {});
    return () => ctl.abort();
  }, [bbox, layers]);

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
      ms.push(
        map.addHtmlMarker({
          lng: p.lng,
          lat: p.lat,
          zIndex: 50,
          title: p.name,
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

  const sorted = useMemo(() => [...points].sort((a, b) => b.n - a.n), [points]);

  return (
    <div className="-mx-4 -mt-4 flex h-[calc(100dvh-7.5rem)] flex-col lg:mx-0 lg:mt-0 lg:h-[calc(100dvh-4rem)]">
      <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-surface px-4 py-2 lg:rounded-t-xl lg:border">
        {TYPE_OPTIONS.map((o) => (
          <Chip key={o.key} active={type === o.key} onClick={() => setType(o.key)}>
            {o.label}
          </Chip>
        ))}
        <span className="mx-1 w-px shrink-0 bg-border" />
        {(["sale", "jeonse"] as const).map((k) => (
          <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
            {DEAL_KIND_LABEL[k]}
          </Chip>
        ))}
        <span className="mx-1 w-px shrink-0 bg-border" />
        {MONTHS.map((m) => (
          <Chip key={m} active={months === m} onClick={() => setMonths(m)}>
            {m < 12 ? `${m}개월` : `${m / 12}년`}
          </Chip>
        ))}
        <span className="mx-1 w-px shrink-0 bg-border" />
        {LAYERS.map((l) => (
          <Chip
            key={l.key}
            active={layers.has(l.key)}
            onClick={() =>
              setLayers((prev) => {
                const next = new Set(prev);
                if (next.has(l.key)) next.delete(l.key);
                else next.add(l.key);
                return next;
              })
            }
          >
            {l.label}
          </Chip>
        ))}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden lg:rounded-b-xl lg:border lg:border-t-0 lg:border-border">
        <div className="order-2 max-h-[42%] min-h-0 overflow-y-auto border-t border-border bg-surface lg:order-1 lg:max-h-none lg:w-80 lg:border-r lg:border-t-0">
          {selected ? (
            <div className="p-4">
              <button type="button" className="mb-2 text-xs text-accent" onClick={() => setSelected(null)}>
                ← 목록
              </button>
              <h3 className="font-semibold">{selected.name}</h3>
              <p className="text-xs text-muted">
                {detail?.complex?.build_year ? `${detail.complex.build_year}년 · ` : ""}
                {detail?.complex?.households ? `${detail.complex.households.toLocaleString()}세대 · ` : ""}
                최근 {months}개월 {selected.n}건 · 중위 {formatManwon(selected.median_price)}
              </p>
              {detail ? (
                <ul className="mt-3 divide-y divide-border text-sm">
                  {detail.trades.map((t) => (
                    <li key={t.id} className={clsx("flex justify-between py-1.5 tabular", t.is_canceled && "text-muted line-through")}>
                      <span className="text-muted">
                        {formatDate(t.deal_date)} · {DEAL_KIND_LABEL[t.deal_kind]} · {t.area_m2 ? `${Number(t.area_m2).toFixed(0)}㎡` : ""} {t.floor ? `${t.floor}층` : ""}
                      </span>
                      <span className="font-medium">
                        {formatManwon(t.price)}
                        {t.monthly_rent ? `/${t.monthly_rent}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : selected.complex_id ? (
                <p className="mt-3 text-sm text-muted">불러오는 중…</p>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {sorted.length === 0 ? <li className="p-4 text-sm text-muted">이 영역에 해당 기간 거래가 없습니다.</li> : null}
              {sorted.map((p) => (
                <li key={p.key}>
                  <button type="button" onClick={() => select(p)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="text-xs text-muted">
                        {p.n}건 · 최근 {formatDate(p.last_date)}
                      </span>
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

        <div className="relative order-1 min-h-0 flex-1 lg:order-2">
          {/* 네이버 지도는 컨테이너에 position:relative 를 인라인으로 넣어 absolute inset-0 을 덮어쓴다(높이 0 → 빈 화면).
              위치는 바깥 div 가 잡고, 지도는 크기만 채우는 안쪽 div 에 그린다. */}
          <div className="absolute inset-0 z-0">
            <div ref={el} className="map-canvas h-full w-full bg-surface-2" />
          </div>
          {engine === "leaflet" && !keyId && !notice ? (
            <div className="pointer-events-none absolute bottom-6 left-2 z-[500] rounded-md bg-surface/90 px-2 py-1 text-[11px] text-muted shadow">
              대체 지도 · NCP_MAPS_KEY_ID 를 설정하면 네이버 지도로 표시됩니다
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "shrink-0 rounded-full border px-3 py-1 text-[13px]",
        active ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
