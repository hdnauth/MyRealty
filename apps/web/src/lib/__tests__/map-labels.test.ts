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
