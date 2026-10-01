import { describe, expect, it } from "vitest";
import { pinLabel, shortName } from "../../components/map/engines";

describe("지도 라벨", () => {
  it("주소 이름은 시도·시군구를 빼고 지번까지 보인다", () => {
    expect(pinLabel("전남광주통합특별시 광양시 봉강면 조령리 산 164-13", 20)).toBe("봉강면 조령리 산 164-13");
    expect(pinLabel("자연앤자이")).toBe("자연앤자이");
    expect(pinLabel("조례동 영무예다음 아파트")).toBe("조례동 영무예다음 아파트");
  });
  it("단지명은 끝의 N단지를 남긴다", () => {
    expect(shortName("자연앤자이2단지", 7)).toBe("자연앤…2단지");
    expect(shortName("자연앤자이2단지")).toBe("자연앤자이2단지");
    expect(shortName("광교중흥에스클래스", 9)).toBe("광교중흥에스클래스");
    expect(shortName("광교중흥에스클래스아파트", 9)).toBe("광교중흥에스클래…");
  });
});

import { declutter } from "../../components/map/engines";

describe("declutter", () => {
  const bbox: [number, number, number, number] = [127.0, 37.0, 127.1, 37.1];
  const size = { width: 1000, height: 1000 };
  it("겹치는 라벨은 앞의 것(중요한 것)만 남긴다", () => {
    const pts = [
      { id: "a", lng: 127.05, lat: 37.05 },
      { id: "b", lng: 127.0501, lat: 37.0501 },
      { id: "c", lng: 127.02, lat: 37.02 },
    ];
    expect(declutter(pts, bbox, size).map((p) => p.id)).toEqual(["a", "c"]);
  });
  it("keep 인 점(내 단지)이 먼저 자리를 잡고, 겹치는 다른 라벨은 숨긴다", () => {
    const pts = [
      { id: "a", lng: 127.05, lat: 37.05 },
      { id: "b", lng: 127.0501, lat: 37.0501 },
    ];
    expect(declutter(pts, bbox, size, { keep: (p) => p.id === "b" }).map((p) => p.id)).toEqual(["b"]);
  });
});

import { clusterByDistance, distanceKm } from "../../components/map/engines";

describe("내 부동산 지역 묶기", () => {
  const seoul = { lng: 126.978, lat: 37.5665 };
  const suwon = { lng: 127.0286, lat: 37.2636 };
  const busan = { lng: 129.0756, lat: 35.1796 };
  const busan2 = { lng: 129.16, lat: 35.16 };
  it("거리는 km 로 계산한다", () => {
    expect(distanceKm(seoul, busan)).toBeGreaterThan(300);
    expect(distanceKm(seoul, busan)).toBeLessThan(350);
  });
  it("30km 안에 이어지는 점끼리 묶고 큰 묶음을 앞에 둔다", () => {
    const g = clusterByDistance([busan, seoul, busan2, suwon], 40);
    expect(g.map((x) => x.length)).toEqual([2, 2]);
    expect(clusterByDistance([seoul, busan, busan2], 30)).toEqual([[busan, busan2], [seoul]]);
    expect(clusterByDistance([], 30)).toEqual([]);
  });
});
