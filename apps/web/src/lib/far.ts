// 용도지역별 용적률 상한(참고용 — ETL analytics/location.py far_cap 과 같음).
// 서울은 서울시 도시계획 조례 값, 그 밖은 국토계획법 시행령의 법정 상한이다. 시·군 조례는 대개 법정 상한보다 낮게 정하므로
// 서울 밖의 '여유'는 크게 나올 수 있다 — 화면에 기준을 함께 보여 준다.

export const FAR_CAP_SEOUL: Record<string, number> = {
  제1종전용주거지역: 100,
  제2종전용주거지역: 120,
  제1종일반주거지역: 150,
  제2종일반주거지역: 200,
  제3종일반주거지역: 250,
  준주거지역: 400,
};

export const FAR_CAP_LAW: Record<string, number> = {
  제1종전용주거지역: 100,
  제2종전용주거지역: 150,
  제1종일반주거지역: 200,
  제2종일반주거지역: 250,
  제3종일반주거지역: 300,
  준주거지역: 500,
};

export type FarBasis = "seoul" | "law";
export const FAR_BASIS_LABEL: Record<FarBasis, string> = { seoul: "서울시 조례", law: "법정 상한·시 조례 확인" };

/** 용도지역 목록 중 주거 계열 첫 항목의 상한. 시군구 코드가 11 로 시작하면 서울 조례 */
export function farCap(zones: string[] | null | undefined, sggCd: string | null | undefined): { zone: string; cap: number; basis: FarBasis } | null {
  const basis: FarBasis = (sggCd ?? "").startsWith("11") ? "seoul" : "law";
  const table = basis === "seoul" ? FAR_CAP_SEOUL : FAR_CAP_LAW;
  const zone = (zones ?? []).find((z) => z in table);
  return zone ? { zone, cap: table[zone], basis } : null;
}
