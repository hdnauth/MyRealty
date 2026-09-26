/** 뉴스 매칭용 키워드 자동 생성 */
export function buildKeywords(p: {
  type: string;
  buildingName: string | null;
  emdName: string | null;
  sggName: string | null;
  extra?: string | null;
}): string[] {
  const out = new Set<string>();
  const emd = p.emdName?.split(" ").at(-1) ?? null;
  const sgg = p.sggName?.split(" ").at(-1) ?? null;
  if (p.buildingName && p.buildingName.length >= 2) {
    out.add(p.buildingName);
    if (p.type === "apt") out.add(`${p.buildingName} 재건축`);
  }
  if (emd) {
    const suffix = p.type === "land" || p.type === "forest" ? "토지" : p.type === "apt" ? "아파트" : "부동산";
    out.add(`${emd} ${suffix}`);
  }
  if (sgg) out.add(`${sgg} 부동산`);
  for (const k of (p.extra ?? "").split(",")) {
    const t = k.trim();
    if (t) out.add(t);
  }
  return [...out].slice(0, 8);
}
