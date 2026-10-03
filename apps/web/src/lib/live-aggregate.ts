// 수집 전 지역 미리보기 집계(서버·테스트 공용 순수 함수) — lib/live-preview.ts

import type { MapPoint } from "./map-filters";
import type { LiveTrade } from "./rtms-parse";

const PY = 3.305785;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 거래 묶음 → 지도 점(라벨·목록·선택 카드가 쓰는 MapPoint 모양) */
export function aggregateLive(key: string, kind: MapPoint["kind"], name: string, lng: number, lat: number, rows: LiveTrade[]): MapPoint {
  const recent = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const ppy = rows.filter((t) => t.area && t.area > 0).map((t) => t.price / (t.area! / PY));
  const rents = rows.map((t) => t.rent).filter((r): r is number => r !== null && r > 0);
  const years = rows.map((t) => t.buildYear).filter((y): y is number => y !== null);
  return {
    key,
    kind,
    complex_id: null,
    name,
    lng,
    lat,
    n: rows.length,
    median_price: median(rows.map((t) => t.price)) ?? 0,
    median_ppy: median(ppy),
    median_rent: median(rents),
    last_date: recent[0]?.date ?? "",
    build_year: years.length ? Math.min(...years) : null,
    households: null,
    jeonse_ratio: null,
    change_1y: null,
    loc_score: null,
    live: true,
    recent: recent.slice(0, 8).map((t) => ({ date: t.date, price: t.price, rent: t.rent, area: t.area, floor: t.floor, name: t.name || t.umd })),
  };
}

