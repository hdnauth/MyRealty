// 물건 유형 정의 (서버·클라이언트 공용)

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
