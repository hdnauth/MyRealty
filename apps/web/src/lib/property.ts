// 부동산 유형 정의 (서버·클라이언트 공용)

export const PROPERTY_TYPES = {
  apt: { label: "아파트", tx: "apt", hasComplex: true },
  officetel: { label: "오피스텔", tx: "officetel", hasComplex: true },
  rowhouse: { label: "빌라(연립/다세대)", tx: "rowhouse", hasComplex: true },
  house: { label: "단독/다가구", tx: "house", hasComplex: false },
  land: { label: "토지", tx: "land", hasComplex: false },
  forest: { label: "임야", tx: "land", hasComplex: false },
  commercial: { label: "상가/업무", tx: "commercial", hasComplex: false },
} as const;

export type PropertyType = keyof typeof PROPERTY_TYPES;

export const TX_TYPE_LABEL: Record<string, string> = {
  apt: "아파트",
  officetel: "오피스텔",
  rowhouse: "연립/다세대",
  house: "단독/다가구",
  land: "토지",
  commercial: "상업업무용",
  presale: "분양권",
};

export const DEAL_KIND_LABEL: Record<string, string> = { sale: "매매", jeonse: "전세", wolse: "월세" };

export const GROUP_TAGS = {
  owned: "보유",
  candidate: "매수 후보",
  watch: "관심",
  tenant: "전월세 거주",
} as const;
export type GroupTag = keyof typeof GROUP_TAGS;

/**
 * 주변 거래·입지를 볼 기본 반경(m). 단지형은 촘촘해 1km, 단독·상가 2km,
 * 토지·임야는 거래가 드물고 읍면동이 넓어 5km·10km(같은 지목·면적대 거래를 모으려면 넓어야 한다)
 */
export function defaultRadius(type: PropertyType): number {
  if (type === "forest") return 10000;
  if (type === "land") return 5000;
  return PROPERTY_TYPES[type].hasComplex ? 1000 : 2000;
}

/** 주변 거래를 볼 기간(개월): 거래가 드문 유형일수록 길게 */
export function nearbyMonths(type: PropertyType): number {
  if (type === "land" || type === "forest") return 36;
  return PROPERTY_TYPES[type].hasComplex ? 6 : 12;
}

export function isPropertyType(v: string): v is PropertyType {
  return v in PROPERTY_TYPES;
}

/** PNU 19자리 = 법정동코드(10) + 산(1:일반,2:산) + 본번(4) + 부번(4) */
export function makePnu(lawdCd: string, mountain: boolean, bonbun: number | string, bubun: number | string) {
  if (!/^\d{10}$/.test(lawdCd)) return null;
  const b1 = Number(bonbun);
  const b2 = Number(bubun || 0);
  if (!Number.isFinite(b1) || !Number.isFinite(b2)) return null;
  return `${lawdCd}${mountain ? 2 : 1}${String(b1).padStart(4, "0")}${String(b2).padStart(4, "0")}`;
}

/**
 * "현재 시세" 한 가지 기준(홈·목록·포트폴리오·상세 개요가 같은 값을 보이도록):
 * 추정 시세(AVM) → 같은 단지·평형 6개월 매매 중위 → 최근 매매 → 매입가(시세 근거가 없을 때 손익 0으로 둔다)
 */
export type ValueSource = "estimate" | "median6m" | "last" | "purchase";
export const VALUE_SOURCE_LABEL: Record<ValueSource, string> = {
  estimate: "추정 시세",
  median6m: "6개월 중위",
  last: "최근 거래",
  purchase: "매입가 기준",
};
export function currentValue(i: {
  estimate: number | null;
  median6m?: number | null;
  last_trade_price?: number | null;
  purchase_price?: number | null;
}): { value: number | null; source: ValueSource | null } {
  if (i.estimate) return { value: i.estimate, source: "estimate" };
  if (i.median6m) return { value: Math.round(i.median6m), source: "median6m" };
  if (i.last_trade_price) return { value: i.last_trade_price, source: "last" };
  if (i.purchase_price) return { value: i.purchase_price, source: "purchase" };
  return { value: null, source: null };
}
