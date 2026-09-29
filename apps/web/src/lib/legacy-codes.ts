/**
 * 행정구역 개편(2026 전남광주통합특별시) 신·구 코드. ETL services/etl/src/myrealty_etl/codes.py 와 같은 표.
 * 공공데이터포털(실거래·건축물대장)은 새 시군구 코드(12xxx)로만, 브이월드(토지특성·공시지가)는 아직 옛 코드
 * (전라남도 46xxx·광주광역시 29xxx)로만 답한다. 읍면동·리 이하 5자리는 같아 앞 5자리만 바꾼다.
 */
const LEGACY_SGG_BY_NAME: Record<string, Record<string, string>> = {
  전남광주통합특별시: {
    목포시: "46110", 여수시: "46130", 순천시: "46150", 나주시: "46170", 광양시: "46230",
    담양군: "46710", 곡성군: "46720", 구례군: "46730", 고흥군: "46770", 보성군: "46780",
    화순군: "46790", 장흥군: "46800", 강진군: "46810", 해남군: "46820", 영암군: "46830",
    무안군: "46840", 함평군: "46860", 영광군: "46870", 장성군: "46880", 완도군: "46890",
    진도군: "46900", 신안군: "46910",
    동구: "29110", 서구: "29140", 남구: "29155", 북구: "29170", 광산구: "29200",
  },
};

export function isReorganizedSido(sido: string | null | undefined): boolean {
  return Boolean(sido && LEGACY_SGG_BY_NAME[sido.trim()]);
}

/** 새 코드 PNU → 옛 코드 PNU(브이월드 조회용). 해당 없으면 null */
export function legacyPnu(pnu: string | null | undefined, sido: string | null | undefined, sigungu: string | null | undefined): string | null {
  if (!pnu || pnu.length !== 19 || !sido || !sigungu) return null;
  const old = LEGACY_SGG_BY_NAME[sido.trim()]?.[sigungu.trim().split(/\s+/).at(-1) ?? ""];
  return old && old !== pnu.slice(0, 5) ? `${old}${pnu.slice(5)}` : null;
}
