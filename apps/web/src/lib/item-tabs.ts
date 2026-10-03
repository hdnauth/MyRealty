// 부동산 상세 탭(질문 중심 5개)과 예전 탭 주소 → 합쳐진 위치 (서버·미들웨어 공용 순수 함수)

export const ITEM_TABS = [
  { key: "overview", label: "요약" },
  { key: "price", label: "시세" },
  { key: "location", label: "입지" },
  { key: "news", label: "소식" },
  { key: "notes", label: "메모" },
] as const;

/** 예전 8개 탭 중 합쳐진 것: 주변 → 시세의 비교, 분석 → 요약의 AI, 이야기 → 소식 아래 */
const LEGACY: Record<string, { tab: string; hash: string }> = {
  nearby: { tab: "price", hash: "compare" },
  analysis: { tab: "overview", hash: "ai" },
  talk: { tab: "news", hash: "talk" },
};

/** /items/{id}?tab=nearby 처럼 예전 주소면 새 주소(경로+쿼리+해시), 아니면 null. 알림·메일·북마크 링크를 살린다 */
export function legacyItemTabHref(pathname: string, search: URLSearchParams): string | null {
  if (!/^\/items\/[0-9a-f-]{36}$/i.test(pathname)) return null;
  const old = search.get("tab");
  const to = old ? LEGACY[old] : undefined;
  if (!to) return null;
  const q = new URLSearchParams();
  for (const [k, v] of search) {
    if (k === "tab") continue;
    // 주변 탭의 "전체 보기"(all)는 시세 탭에서 nall(주변 거래 전체)
    q.set(k === "all" && old === "nearby" ? "nall" : k, v);
  }
  q.set("tab", to.tab);
  return `${pathname}?${q}#${to.hash}`;
}
