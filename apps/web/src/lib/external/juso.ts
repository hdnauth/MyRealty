import "server-only";
import { env } from "../env";

/** 행정안전부 도로명주소 검색 API 결과(필요한 필드만) */
export type JusoResult = {
  roadAddr: string;
  jibunAddr: string;
  admCd: string; // 법정동코드 10자리
  siNm: string;
  sggNm: string;
  emdNm: string;
  liNm: string;
  bdNm: string;
  lnbrMnnm: string;
  lnbrSlno: string;
  mtYn: string; // 0 대지, 1 산
  bdKdcd: string; // 1 공동주택
  bdMgtSn: string; // 건물관리번호
  detBdNmList: string; // 상세건물명(동 목록, 쉼표 구분)
  zipNo: string;
};

export async function searchJuso(keyword: string, count = 10): Promise<JusoResult[] | null> {
  if (!env.jusoKey) return null;
  const params = new URLSearchParams({
    confmKey: env.jusoKey,
    currentPage: "1",
    countPerPage: String(count),
    keyword,
    resultType: "json",
  });
  const res = await fetch(`https://business.juso.go.kr/addrlink/addrLinkApi.do?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`juso HTTP ${res.status}`);
  const data = await res.json();
  const common = data?.results?.common;
  if (common?.errorCode !== "0") throw new Error(`juso ${common?.errorCode}: ${common?.errorMessage}`);
  return (data.results.juso ?? []) as JusoResult[];
}

export function jibunOf(j: Pick<JusoResult, "lnbrMnnm" | "lnbrSlno" | "mtYn">) {
  const main = Number(j.lnbrMnnm);
  const sub = Number(j.lnbrSlno);
  return `${j.mtYn === "1" ? "산 " : ""}${main}${sub ? `-${sub}` : ""}`;
}
