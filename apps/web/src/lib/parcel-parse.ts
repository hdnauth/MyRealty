/** 지번·PNU·주소 문자열 파싱(서버·테스트 공용, 외부 호출 없음) */

/** 검색어가 지번을 담고 있는지(숫자 또는 '산 12' 형태) */
export function looksLikeJibun(q: string) {
  return /(^|\s)산\s*\d/.test(q) || /\d+(-\d+)?\s*(번지)?\s*$/.test(q.trim());
}

/** "충청북도 괴산군 연풍면 원풍리 산164-1" → 시도·시군구·읍면동리 */
export function splitRegion(address: string): { sidoName: string | null; sggName: string | null; emdName: string | null } {
  const tokens = address.split(/\s+/).filter(Boolean);
  // 지번(산 / 숫자) 앞까지만
  const cut = tokens.findIndex((t) => /^산?\d/.test(t) || t === "산");
  const parts = cut >= 0 ? tokens.slice(0, cut) : tokens;
  if (!parts.length) return { sidoName: null, sggName: null, emdName: null };
  const sido = /(도|시|특별자치시|특별시|광역시)$/.test(parts[0]) ? parts[0] : null;
  const rest = sido ? parts.slice(1) : parts;
  const sgg: string[] = [];
  let i = 0;
  // 세종특별자치시처럼 시군구가 없는 곳은 바로 읍면동
  while (i < rest.length && /(시|군|구)$/.test(rest[i]) && !/(읍|면|동|리|가)$/.test(rest[i])) sgg.push(rest[i++]);
  const emd = rest.slice(i).join(" ");
  return { sidoName: sido, sggName: sgg.join(" ") || null, emdName: emd || null };
}

export function parsePnu(pnu: string) {
  if (!/^\d{19}$/.test(pnu)) return null;
  const bonbun = Number(pnu.slice(11, 15));
  const bubun = Number(pnu.slice(15, 19));
  const mountain = pnu[10] === "2";
  return {
    lawdCd: pnu.slice(0, 10),
    sggCd: pnu.slice(0, 5),
    mountain,
    bonbun,
    bubun,
    jibun: `${mountain ? "산 " : ""}${bonbun}${bubun ? `-${bubun}` : ""}`,
  };
}
