/*
 * 개발사업(정비사업·철도/도로) 공통 상수. ETL collectors/projects.py · seoul_cleanup.py 와 같은 단계 체계.
 */

/** 정비사업 9단계 진행도(stage_order 1~9) */
export const ZONE_STAGES = ["기본계획", "정비구역지정", "추진위", "조합설립", "사업시행인가", "관리처분인가", "이주·철거", "착공", "준공"];
export const ZONE_KINDS = ["재건축", "재개발", "도시정비형재개발", "주거환경개선", "가로주택", "소규모재건축", "소규모재개발", "리모델링", "지역주택조합", "기타"];
export const INFRA_STATUS = ["계획", "예타", "설계", "착공", "개통예정", "개통"];

/** 단계 묶음 — 목록 필터·지도 색. 같은 묶음이면 투자 판단(불확실성·환금성)이 비슷하다 */
export const ZONE_PHASES = [
  { key: "early", label: "초기", sub: "기본계획~추진위", from: 1, to: 3 },
  { key: "union", label: "조합설립", sub: "조합설립인가", from: 4, to: 4 },
  { key: "approved", label: "인가", sub: "사업시행·관리처분", from: 5, to: 6 },
  { key: "building", label: "이주·착공", sub: "이주·철거·착공·분양", from: 7, to: 8 },
  { key: "done", label: "완료", sub: "준공·해산·청산", from: 9, to: 9 },
] as const;
export type ZonePhase = (typeof ZONE_PHASES)[number]["key"];

export function zonePhase(order: number | null | undefined): ZonePhase | null {
  if (!order) return null;
  return ZONE_PHASES.find((p) => order >= p.from && order <= p.to)?.key ?? null;
}

/** 지도 마커 색(단계 묶음별, 진할수록 사업이 진척) */
export const PHASE_COLOR: Record<ZonePhase | "none", string> = {
  early: "#8b80d6",
  union: "#6a5cc4",
  approved: "#4a3aa7",
  building: "#2f2380",
  done: "#8a8f98",
  none: "#8a8f98",
};

/** 개발·테마 탭 */
export const THEME_TABS = [
  { key: "zones", label: "정비사업" },
  { key: "rebuild", label: "재건축 후보" },
  { key: "transit", label: "교통 호재" },
  { key: "regulation", label: "규제" },
  { key: "supply", label: "공급" },
] as const;
export type ThemeTab = (typeof THEME_TABS)[number]["key"];

/** '서울특별시' → '서울', '경기도' → '경기', '전남광주통합특별시' → '전남광주' */
export function shortSido(name: string | null | undefined) {
  if (!name) return "";
  const m: Record<string, string> = { 충청북도: "충북", 충청남도: "충남", 전라북도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남" };
  return m[name] ?? name.replace(/(특별자치시|특별자치도|통합특별시|특별시|광역시|도)$/, "");
}

/** 구역 위치 정밀도(attrs.geo) — 대략 위치는 화면에 표시한다 */
export const GEO_LABEL: Record<string, string> = {
  boundary: "구역 경계",
  address: "대표지번",
  complex: "같은 이름 단지",
  place: "장소 검색(대략)",
  dong: "법정동 중심(대략)",
};

/** 정비구역 출처 */
export const ZONE_SOURCE: Record<string, { label: string; url?: string }> = {
  seoul: { label: "서울 정비사업 정보몽땅", url: "https://cleanup.seoul.go.kr" },
  gyeonggi: { label: "경기도 정비사업 종합관리 시스템", url: "https://www.gg.go.kr/onnuri/index.do" },
  busan: { label: "부산 정비사업 통합홈페이지", url: "https://dynamice.busan.go.kr" },
  incheon: { label: "인천 정비사업 정보", url: "https://renewal.incheon.go.kr" },
  molit: { label: "국토교통부 전국 도시정비사업 통합 데이터", url: "https://www.data.go.kr/data/15160169/fileData.do" },
  manual: { label: "직접 등록" },
  file: { label: "파일 가져오기" },
};
export function zoneSource(source: string) {
  return ZONE_SOURCE[source] ?? (source.startsWith("dgk") ? { label: "공공데이터포털 시·군·구 자료" } : { label: source });
}
