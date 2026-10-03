import { describe, expect, it } from "vitest";
import { bottomTabs, isActive, navSections, watchHref } from "../../components/shell/nav-config";

describe("관심 탭 대상", () => {
  it("관심 부동산이 있으면 요약 홈, 없으면 목록·등록 안내", () => {
    expect(watchHref(true)).toBe("/");
    expect(watchHref(false)).toBe("/items");
    expect(bottomTabs(false)[1].href).toBe("/items");
  });
});

describe("메뉴 활성 판정", () => {
  const tabs = bottomTabs(true);
  const active = (path: string) => tabs.filter((t) => isActive(path, t, tabs)).map((t) => t.label);

  it("경로마다 하단 탭 하나만 활성", () => {
    expect(active("/")).toEqual(["관심"]);
    expect(active("/items/abc")).toEqual(["관심"]);
    expect(active("/map")).toEqual(["지도"]);
    expect(active("/projects")).toEqual(["시장"]);
    expect(active("/community/posts/3")).toEqual(["동네"]);
    expect(active("/settings")).toEqual(["전체"]);
    expect(active("/ai")).toEqual(["전체"]);
  });

  it("사이드바는 더 구체적인 메뉴만 활성(/indicators/custom → 커스텀 지표)", () => {
    const all = navSections(true).flatMap((s) => s.items);
    const on = (path: string) => all.filter((n) => isActive(path, n, all)).map((n) => n.label);
    expect(on("/indicators/custom")).toEqual(["커스텀 지표"]);
    expect(on("/indicators")).toEqual(["시장 지표"]);
    expect(on("/")).toEqual(["관심 부동산"]);
  });
});
