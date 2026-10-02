import { describe, expect, it } from "vitest";
import { addResidenceCheck, dailyLimit, excerpt, levelOf, nicknameError, screenText } from "../community/rules";

describe("screenText", () => {
  it("passes ordinary text untouched", () => {
    const r = screenText("이번 달 84㎡ 실거래가 25억으로 올랐네요. 학군 수요가 꾸준한 듯합니다.");
    expect(r.action).toBe("pass");
    expect(r.flags).toEqual([]);
  });

  it("masks phone numbers, emails and unit numbers but still passes", () => {
    const r = screenText("101동 1203호 사는데 010-1234-5678 로 연락 주세요 me@test.com");
    expect(r.text).not.toContain("1234-5678");
    expect(r.text).not.toContain("1203호");
    expect(r.text).toContain("***@test.com");
    expect(r.flags.map((f) => f.label)).toEqual(expect.arrayContaining(["전화번호", "동·호수", "이메일"]));
    expect(r.action).toBe("pass");
  });

  it("holds price-collusion attempts", () => {
    for (const t of ["우리 단지는 20억 이하로는 절대 팔지 맙시다", "호가 지키자 다들", "저 중개소는 거래하지 맙시다 불매", "급매 매물은 허위 매물로 신고해 주세요"]) {
      const r = screenText(t);
      expect(r.flags.some((f) => f.code === "collusion"), t).toBe(true);
      expect(r.action).toBe("hold");
    }
  });

  it("does not flag discussion about collusion in general", () => {
    expect(screenText("집값 담합은 불법이라 신고 대상이라고 하네요").action).toBe("pass");
  });

  it("holds ads and abuse", () => {
    expect(screenText("분양 문의 주세요 오픈채팅 링크").action).toBe("hold");
    expect(screenText("이런 병신 같은 글").flags.some((f) => f.code === "abuse")).toBe(true);
  });

  it("flags unknown links but allows public/news sources", () => {
    expect(screenText("참고 https://www.molit.go.kr/abc").flags).toEqual([]);
    expect(screenText("기사 https://n.news.naver.com/article/1").flags).toEqual([]);
    const r = screenText("여기 보세요 https://spam.example.com/x");
    expect(r.flags.map((f) => f.code)).toEqual(["link"]);
    expect(r.action).toBe("pass");
  });
});

describe("nicknameError", () => {
  it("validates", () => {
    expect(nicknameError("잠실주민")).toBeNull();
    expect(nicknameError("a")).not.toBeNull();
    expect(nicknameError("가나다라마바사아자차카타파")).not.toBeNull();
    expect(nicknameError("12345")).not.toBeNull();
    expect(nicknameError("관리자123")).not.toBeNull();
    expect(nicknameError("hello world")).not.toBeNull();
  });
});

describe("levels and limits", () => {
  it("levels by points", () => {
    expect(levelOf(0).label).toBe("새내기");
    expect(levelOf(20).label).toBe("이웃");
    expect(levelOf(150).label).toBe("단골");
    expect(levelOf(999).label).toBe("터줏대감");
    expect(levelOf(-5).rank).toBe(0);
  });
  it("limits fresh accounts", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    expect(dailyLimit("post", new Date("2026-10-02T00:00:00Z"), now)).toBe(3);
    expect(dailyLimit("post", new Date("2026-09-01T00:00:00Z"), now)).toBe(20);
  });
  it("excerpts", () => {
    expect(excerpt("a\n\nb   c")).toBe("a b c");
    expect(excerpt("x".repeat(10), 5)).toBe("xxxxx…");
  });
});

describe("addResidenceCheck", () => {
  it("verifies after 3 distinct days in range", () => {
    let c: { day: string; dist: number }[] = [];
    c = addResidenceCheck(c, "2026-10-01", 40).checks;
    c = addResidenceCheck(c, "2026-10-01", 30).checks; // 같은 날은 한 번
    expect(c).toHaveLength(1);
    c = addResidenceCheck(c, "2026-10-03", 900).checks; // 범위 밖은 기록 안 함
    expect(c).toHaveLength(1);
    c = addResidenceCheck(c, "2026-10-05", 100).checks;
    const r = addResidenceCheck(c, "2026-10-09", 10);
    expect(r.verified).toBe(true);
  });
  it("drops checks outside the window", () => {
    const r = addResidenceCheck([{ day: "2026-08-01", dist: 10 }, { day: "2026-08-02", dist: 10 }], "2026-10-02", 10);
    expect(r.checks).toHaveLength(1);
    expect(r.verified).toBe(false);
  });
});
