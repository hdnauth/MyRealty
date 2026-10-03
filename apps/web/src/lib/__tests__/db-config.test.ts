import { describe, expect, it } from "vitest";
import { maxPipeline, shouldPrepare } from "../db-config";

const SESSION = "postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres";
const TXN = "postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://u:p@localhost:5432/myrealty";

describe("DB 연결 설정", () => {
  it("트랜잭션 풀러는 prepared statement 를 끈다", () => {
    expect(shouldPrepare(TXN, undefined)).toBe(false);
    expect(shouldPrepare(SESSION, undefined)).toBe(true);
    expect(shouldPrepare(SESSION, "false")).toBe(false);
  });
  it("풀러 주소면 파이프라이닝을 끈다(운영에서 쿼리가 멈추던 원인), 직접 연결은 기본값", () => {
    expect(maxPipeline(TXN, undefined)).toBe(0);
    expect(maxPipeline(SESSION, undefined)).toBe(0);
    expect(maxPipeline("postgresql://u:p@ep-x-pooler.neon.tech/db", undefined)).toBe(0);
    expect(maxPipeline(LOCAL, undefined)).toBeUndefined();
    expect(maxPipeline(TXN, "50")).toBe(50);
    expect(maxPipeline(TXN, "")).toBe(0);
  });
});
