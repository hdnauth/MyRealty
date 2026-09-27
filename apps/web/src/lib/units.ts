// 부동산 등록 자동 입력용 순수 함수(서버·클라이언트 공용): 평형 묶기, 동·호 정리, 건물 용도 → 유형

import type { PropertyType } from "./property";

export const M2_PER_PYEONG = 3.305785;

export function pyeong(m2: number) {
  return m2 / M2_PER_PYEONG;
}

/** 등록 화면에서 고르는 평형(전용면적 기준 한 묶음) */
export type AreaType = {
  /** 대표 전용면적(㎡) — 묶음에서 가장 흔한 값 */
  area: number;
  /** 공급면적 추정(㎡, 건축물대장 전유+주거공용). 모르면 null */
  supply: number | null;
  /** 건축물대장 기준 세대(호) 수 */
  units: number | null;
  /** 실거래 건수(전체 기간, 매매·전월세) */
  trades: number;
  /** 최근 1년 매매 중위가(만원) */
  medianPrice: number | null;
};

/** [동, 호, 층, 전용면적] — 응답 크기를 줄이려고 튜플로 보낸다 */
export type UnitTuple = [dong: string, ho: string, floor: number | null, area: number];

type AreaSample = { area: number; count: number; supply?: number | null; units?: number; trades?: number; medianPrice?: number | null };

/**
 * 비슷한 전용면적(±0.5㎡, 예: 84.97·84.98·84.99)을 한 평형으로 묶는다.
 * 대표 면적은 건수가 가장 많은 값, 공급면적은 대표 값의 것(없으면 묶음 내 첫 값).
 */
export function clusterAreas(samples: AreaSample[], tolerance = 0.5): AreaType[] {
  const sorted = samples.filter((s) => s.area > 0).sort((a, b) => a.area - b.area);
  const groups: AreaSample[][] = [];
  for (const s of sorted) {
    const g = groups.at(-1);
    if (g && s.area - g[0].area <= tolerance) g.push(s);
    else groups.push([s]);
  }
  return groups.map((g) => {
    const rep = g.reduce((a, b) => (b.count > a.count ? b : a));
    const units = g.reduce((n, s) => n + (s.units ?? 0), 0);
    const priced = g.filter((s) => s.medianPrice != null);
    return {
      area: rep.area,
      supply: rep.supply ?? g.find((s) => s.supply != null)?.supply ?? null,
      units: units || null,
      trades: g.reduce((n, s) => n + (s.trades ?? 0), 0),
      medianPrice: priced.length ? priced.reduce((a, b) => ((b.trades ?? 0) > (a.trades ?? 0) ? b : a)).medianPrice ?? null : null,
    };
  });
}

/** 전용면적이 속한 평형(대표 면적). 없으면 null */
export function matchAreaType(types: AreaType[], area: number, tolerance = 0.5): AreaType | null {
  let best: AreaType | null = null;
  for (const t of types) {
    const d = Math.abs(t.area - area);
    if (d <= tolerance && (!best || d < Math.abs(best.area - area))) best = t;
  }
  return best;
}

/** 평형 표기: 공급면적을 알면 "34평형", 모르면 전용 평 "전용 25.7평" */
export function areaTypeLabel(t: Pick<AreaType, "area" | "supply">) {
  return t.supply ? `${Math.round(pyeong(t.supply))}평형` : `전용 ${pyeong(t.area).toFixed(1)}평`;
}

/** 호수 → 층 (1502 → 15, 302 → 3, B102·지하 → null) */
export function floorFromHo(ho: string): number | null {
  const s = ho.replace(/\s+/g, "").replace(/호$/, "");
  if (!/^\d{3,5}$/.test(s)) return null;
  const f = Number(s.slice(0, -2));
  return f > 0 ? f : null;
}

/** "101", "제101동", "101동" → "101동" (숫자만이면 동을 붙인다) */
export function dongLabel(d: string) {
  const s = d.trim().replace(/^제\s*/, "");
  return /^\d+$/.test(s) ? `${s}동` : s;
}

/** "1502", "1502호" → "1502호" */
export function hoLabel(h: string) {
  const s = h.trim();
  return /호$/.test(s) ? s : `${s}호`;
}

export function dongHo(dong: string, ho: string) {
  return [dong ? dongLabel(dong) : "", ho ? hoLabel(ho) : ""].filter(Boolean).join(" ");
}

const NON_RESIDENTIAL_DONG = /관리|상가|경비|노인|경로|보육|어린이|유치원|주민|커뮤니티|근린|기계|전기|펌프|부속|창고|주차|복리|문고|체육|휘트니스|피트니스/;

/** 도로명주소 detBdNmList("101동,102동,관리동") → 주거동만, 숫자 순 */
export function parseDongList(list: string | null | undefined): string[] {
  if (!list) return [];
  const seen = new Set<string>();
  for (const raw of list.split(",")) {
    const d = raw.trim();
    if (d && !NON_RESIDENTIAL_DONG.test(d)) seen.add(d);
  }
  return sortDongs([...seen]);
}

function numPrefix(s: string) {
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
}

export function sortDongs(ds: string[]) {
  return [...ds].sort((a, b) => numPrefix(a) - numPrefix(b) || a.localeCompare(b, "ko"));
}

/** 건축물대장 주용도·기타용도 → 부동산 유형 */
export function typeFromPurpose(mainPurpose: string | null | undefined, etcPurpose: string | null | undefined): PropertyType | null {
  const s = `${mainPurpose ?? ""} ${etcPurpose ?? ""}`;
  if (!s.trim()) return null;
  if (/오피스텔/.test(s)) return "officetel";
  if (/아파트/.test(s)) return "apt";
  if (/연립|다세대/.test(s)) return "rowhouse";
  if (/단독|다가구|다중주택|공관/.test(s)) return "house";
  if (/공동주택/.test(s)) return "apt";
  if (/근린|판매|업무|숙박|의료|교육|운동|위락|공장|창고|자동차|종교|문화|집회/.test(s)) return "commercial";
  return null;
}

/** 지목 → 유형(건물이 없을 때) */
export function typeFromJimok(jimok: string | null | undefined, mountain: boolean): PropertyType {
  if (mountain || (jimok && /임야/.test(jimok))) return "forest";
  return "land";
}

// ───────── 건축물대장 전유공용면적 → 호별 면적 ─────────

const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const num = (v: unknown) => {
  const x = Number(str(v).replace(/,/g, ""));
  return str(v) !== "" && Number.isFinite(x) ? x : null;
};

// 주거 공용이 아닌 공용부분(주차장·관리동·기계실 등)은 공급면적 추정에서 뺀다
const NON_SUPPLY_COMMON = /주차|기계|전기|발전|관리|경비|노인|경로|보육|어린이|주민|근린|판매|복리|커뮤니티|저수|물탱크|펌프|정화조|창고/;

export type UnitInfo = { dong: string; ho: string; floor: number | null; area: number; supply: number | null; purpose: string | null };

/** 전유공용면적 행들 → 호별 전용·공급(추정) 면적 */
export function aggregateUnits(rows: Record<string, unknown>[]): UnitInfo[] {
  const map = new Map<string, { dong: string; ho: string; floor: number | null; excl: number; common: number; purpose: string | null }>();
  for (const r of rows) {
    const ho = str(r.hoNm);
    if (!ho) continue;
    const dong = str(r.dongNm);
    const key = `${dong}|${ho}`;
    const u = map.get(key) ?? { dong, ho, floor: null, excl: 0, common: 0, purpose: null };
    const area = num(r.area) ?? 0;
    const purpose = [str(r.mainPurpsCdNm), str(r.etcPurps)].filter(Boolean).join(" ");
    const isExcl = str(r.exposPubuseGbCd) === "1" || str(r.exposPubuseGbCdNm) === "전유";
    if (isExcl) {
      u.excl += area;
      const f = num(r.flrNo);
      if (f !== null) u.floor = /지하/.test(str(r.flrGbCdNm)) ? -f : f;
      u.purpose ??= purpose || null;
    } else if (!NON_SUPPLY_COMMON.test(purpose) && !/지하/.test(str(r.flrGbCdNm))) {
      u.common += area;
    }
    map.set(key, u);
  }
  const out: UnitInfo[] = [];
  for (const u of map.values()) {
    if (u.excl <= 0) continue;
    const excl = Math.round(u.excl * 100) / 100;
    const supply = u.common > 0 ? Math.round((u.excl + u.common) * 100) / 100 : null;
    // 공용 구분이 이상한 대장(공급/전용 비율이 비현실적)은 공급면적을 버린다
    const ok = supply !== null && supply / excl >= 1.05 && supply / excl <= 1.8;
    out.push({ dong: u.dong, ho: u.ho, floor: u.floor, area: excl, supply: ok ? supply : null, purpose: u.purpose });
  }
  return out;
}

