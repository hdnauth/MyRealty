import { describe, expect, it } from "vitest";
import { errorNote } from "../collect-steps";
import { looksLikeJibun, parsePnu, splitRegion } from "../parcel-parse";

describe("지번 검색 보조", () => {
  it("지번이 들어간 검색어를 알아본다", () => {
    expect(looksLikeJibun("조령리 산 164-1")).toBe(true);
    expect(looksLikeJibun("목왕리 산12")).toBe(true);
    expect(looksLikeJibun("이의동 1353")).toBe(true);
    expect(looksLikeJibun("잠실엘스")).toBe(false);
  });
  it("PNU 를 법정동코드·산·본번·부번으로", () => {
    expect(parsePnu("4376035027201640001")).toEqual({
      lawdCd: "4376035027",
      sggCd: "43760",
      mountain: true,
      bonbun: 164,
      bubun: 1,
      jibun: "산 164-1",
    });
    expect(parsePnu("1171010100100190000")?.jibun).toBe("19");
    expect(parsePnu("123")).toBeNull();
  });
  it("주소에서 시도·시군구·읍면동리", () => {
    expect(splitRegion("충청북도 괴산군 연풍면 조령리 산164-1")).toEqual({ sidoName: "충청북도", sggName: "괴산군", emdName: "연풍면 조령리" });
    expect(splitRegion("경기도 수원시 영통구 이의동 1353")).toEqual({ sidoName: "경기도", sggName: "수원시 영통구", emdName: "이의동" });
    expect(splitRegion("세종특별자치시 조치원읍 신흥리 산 5")).toEqual({ sidoName: "세종특별자치시", sggName: null, emdName: "조치원읍 신흥리" });
  });
});

describe("수집 오류 사유", () => {
  it("사람이 읽는 문장은 그대로", () => {
    expect(errorNote("공공데이터포털: 등록되지 않은 서비스키입니다")).toBe("공공데이터포털: 등록되지 않은 서비스키입니다");
  });
  it("예전 예외 repr 은 상태 코드로 풀어 쓴다", () => {
    expect(errorNote(`HTTPStatusError("Client error '403 Forbidden' for url 'https://apis.data.go.kr/1613000/X'")`)).toContain("공공데이터포털에서 요청을 거부");
    expect(errorNote(`ConnectError("Server disconnected ... api.vworld.kr")`)).toContain("브이월드 연결 실패");
    expect(errorNote("")).toBe("불러오지 못함");
  });
});
