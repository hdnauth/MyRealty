/**
 * 화면 사이 링크 규칙(서버·브라우저 공용). 다른 부동산이 보이는 곳(유사 단지·주변 거래·지도·비교 등)에서
 * 누르면 같은 규칙으로 이동한다.
 * - 단지: 내 관심 부동산이면 그 상세(/items/…), 아니면 단지 상세(/complexes/…)
 * - 단지가 없는 거래(토지·단독 등): 지도에서 그 위치(실거래 좌표는 읍면동 중심일 수 있음)
 */

/** 단지 id → 내 관심 부동산 id(같은 단지를 여러 개 등록했으면 처음 것) */
export type MyComplexes = Record<number, string>;

export function complexHref(complexId: number, mine?: MyComplexes | null, opts: { tab?: string; area?: number | null } = {}): string {
  const itemId = mine?.[complexId];
  if (itemId) return `/items/${itemId}${opts.tab ? `?tab=${opts.tab}` : ""}`;
  // area: 비교하던 면적과 가장 가까운 평형으로 열기(단지 상세가 ±15% 안에서 고른다)
  return `/complexes/${complexId}${opts.area ? `?area=${Number(opts.area).toFixed(1)}` : ""}`;
}

export function mapAtHref(lng: number, lat: number, type?: string | null): string {
  return `/map?at=${lng.toFixed(5)},${lat.toFixed(5)}${type ? `&type=${type}` : ""}`;
}

export function mapComplexHref(complexId: number): string {
  return `/map?complex=${complexId}`;
}

/** 관심 부동산 등록 화면을 이 단지로 채워 연다 */
export function registerComplexHref(complexId: number): string {
  return `/items/new?complex=${complexId}`;
}
