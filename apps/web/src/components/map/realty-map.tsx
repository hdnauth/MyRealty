"use client";

import clsx from "clsx";
import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapPoint } from "@/app/api/map/points/route";
import { Badge } from "@/components/ui";
import { formatDate, formatManwon } from "@/lib/format";
import { DEAL_KIND_LABEL } from "@/lib/property";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    naver?: any;
  }
}

export type MapWatchItem = { id: string; label: string; lng: number; lat: number; radius_m: number; property_type: string };
export type MapEvent = { id: number; title: string; kind: string; lng: number; lat: number; starts_on: string | null };

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
  items,
  events,
  initialCenter,
}: {
  keyId: string | null;
  items: MapWatchItem[];
  events: MapEvent[];
  initialCenter: [number, number];
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [type, setType] = useState("apt");
  const [kind, setKind] = useState<"sale" | "jeonse">("sale");
  const [months, setMonths] = useState(6);
  const [points, setPoints] = useState<MapPoint[]>([]);
  // 키가 없으면 지도 없이 관심물건 주변 영역을 목록으로 조회
  const [bbox, setBbox] = useState<number[] | null>(() =>
    keyId ? null : [initialCenter[0] - 0.05, initialCenter[1] - 0.04, initialCenter[0] + 0.05, initialCenter[1] + 0.04],
  );
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [detail, setDetail] = useState<{ complex: { name: string; build_year: number | null; households: number | null }; trades: Trade[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 지도 초기화
  useEffect(() => {
    if (!ready || !el.current || mapRef.current || !window.naver?.maps) return;
    const { naver } = window;
    const map = new naver.maps.Map(el.current, {
      center: new naver.maps.LatLng(initialCenter[1], initialCenter[0]),
      zoom: 15,
      zoomControl: true,
      zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT },
      mapDataControl: false,
      scaleControl: false,
    });
    mapRef.current = map;
    const update = () => {
      const b = map.getBounds();
      const sw = b.getSW();
      const ne = b.getNE();
      setBbox([sw.lng(), sw.lat(), ne.lng(), ne.lat()]);
    };
    naver.maps.Event.addListener(map, "idle", update);
    update();

    // 관심 물건 핀 + 탐색 반경
    for (const it of items) {
      const pos = new naver.maps.LatLng(it.lat, it.lng);
      new naver.maps.Circle({
        map,
        center: pos,
        radius: it.radius_m,
        strokeColor: "#2563eb",
        strokeOpacity: 0.5,
        strokeWeight: 1,
        fillColor: "#2563eb",
        fillOpacity: 0.04,
        clickable: false,
      });
      const m = new naver.maps.Marker({
        map,
        position: pos,
        zIndex: 1000,
        icon: {
          content: `<a href="/items/${it.id}" style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:999px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap;text-decoration:none">★ ${escapeHtml(it.label)}</a>`,
          anchor: new naver.maps.Point(12, 12),
        },
      });
      void m;
    }
    // 이벤트(청약 등)
    for (const ev of events) {
      new naver.maps.Marker({
        map,
        position: new naver.maps.LatLng(ev.lat, ev.lng),
        zIndex: 500,
        title: ev.title,
        icon: {
          content: `<div title="${escapeHtml(ev.title)}" style="padding:3px 6px;border-radius:6px;background:#eb6834;color:#fff;font-size:11px;font-weight:600;white-space:nowrap">청약 · ${escapeHtml(ev.title.slice(0, 10))}</div>`,
          anchor: new naver.maps.Point(10, 10),
        },
      });
    }
  }, [ready, initialCenter, items, events]);

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
    if (mapRef.current && window.naver) mapRef.current.panTo(new window.naver.maps.LatLng(p.lat, p.lng));
  }, []);

  // 가격 라벨 마커
  useEffect(() => {
    const map = mapRef.current;
    const naver = window.naver;
    if (!map || !naver) return;
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = points.map((p) => {
      const main = p.median_ppy && (type === "apt" || type === "officetel" || type === "rowhouse") ? `${formatManwon(p.median_ppy, { short: true })}/평` : formatManwon(p.median_price, { short: true });
      const active = selected?.key === p.key;
      const marker = new naver.maps.Marker({
        map,
        position: new naver.maps.LatLng(p.lat, p.lng),
        zIndex: active ? 900 : 100,
        icon: {
          content: `<div style="transform:translate(-50%,-100%);display:inline-flex;flex-direction:column;align-items:center;padding:3px 7px;border-radius:8px;background:${active ? "#16191f" : "#ffffff"};color:${active ? "#fff" : "#16191f"};border:1px solid rgba(0,0,0,.12);box-shadow:0 1px 4px rgba(0,0,0,.18);font-size:11px;line-height:1.25;white-space:nowrap;font-weight:600">${main}<span style="font-weight:400;opacity:.7">${escapeHtml(p.name.slice(0, 8))} · ${p.n}건</span></div>`,
          anchor: new naver.maps.Point(0, 0),
        },
      });
      naver.maps.Event.addListener(marker, "click", () => select(p));
      return marker;
    });
  }, [points, selected, type, select]);

  const sorted = useMemo(() => [...points].sort((a, b) => b.n - a.n), [points]);

  return (
    <div className="-mx-4 -mt-4 flex h-[calc(100dvh-7.5rem)] flex-col lg:mx-0 lg:mt-0 lg:h-[calc(100dvh-4rem)]">
      {keyId ? (
        <Script
          src={`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(keyId)}`}
          strategy="afterInteractive"
          onReady={() => setReady(true)}
          onError={() => setLoadError("네이버 지도 스크립트를 불러오지 못했습니다. 키와 서비스 URL 등록을 확인하세요.")}
        />
      ) : null}

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
                      {p.median_ppy ? <span className="block text-[11px] font-normal text-muted">평당 {formatManwon(p.median_ppy, { short: true })}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="relative order-1 min-h-0 flex-1 lg:order-2">
          {keyId ? (
            <div ref={el} className="absolute inset-0 bg-surface-2" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-2 p-6 text-center">
              <p className="font-medium">지도 키가 설정되지 않았습니다</p>
              <p className="max-w-sm text-sm text-muted">
                .env 에 <code>NCP_MAPS_KEY_ID</code>(네이버 클라우드 Maps Client ID)를 설정하면 지도가 표시됩니다. 지금은 관심 물건 주변 거래를 목록으로 보여줍니다.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {items.map((i) => (
                  <Link key={i.id} href={`/items/${i.id}`}>
                    <Badge tone="accent">★ {i.label}</Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {loadError ? <div className="absolute inset-x-4 top-4 rounded-lg bg-warn/90 p-2 text-sm text-white">{loadError}</div> : null}
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
