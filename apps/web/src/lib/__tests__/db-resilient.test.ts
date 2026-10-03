import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createResilientClient } from "../db-resilient";

// 실제 Postgres 가 있을 때만(TEST_DATABASE_URL). CI 에서는 건너뛴다
const url = process.env.TEST_DATABASE_URL;
const made: postgres.Sql[] = [];
const make = () => {
  const c = postgres(url!, { max: 2, idle_timeout: 5 });
  made.push(c);
  return c;
};
afterAll(async () => {
  await Promise.all(made.map((c) => c.end({ timeout: 0 })));
});

describe.skipIf(!url)("멈추지 않는 DB 클라이언트", () => {
  it("쿼리·조각·도우미·트랜잭션은 그대로 동작하고, 조각은 따로 실행되지 않는다", async () => {
    const { client: sql } = createResilientClient(make, { stallMs: 5000, idleRecycleMs: 0 });
    const where = sql`where x > ${1}`;
    const rows = await sql<{ x: number }[]>`select x from (values (1), (2), (3)) v(x) ${where} and x in ${sql([2, 3])} order by x`;
    expect(rows.map((r) => r.x)).toEqual([2, 3]);
    const [j] = await sql<{ j: { a: number } }[]>`select ${sql.json({ a: 1 })}::jsonb as j`;
    expect(j.j).toEqual({ a: 1 });
    const out = await sql.begin(async (tx) => (await tx`select 7 as v`)[0].v);
    expect(out).toBe(7);
    const all = await Promise.all([sql`select 1 as a`, sql`select 2 as a`]);
    expect(all.map((r) => r[0].a)).toEqual([1, 2]);
    await expect(sql`select nope`).rejects.toThrow();
  });

  it("응답 없는 쿼리는 연결 묶음을 바꿔 오류로 끝내고, 다음 쿼리는 새 연결로 성공한다", async () => {
    const reasons: string[] = [];
    const { client: sql } = createResilientClient(make, { stallMs: 300, idleRecycleMs: 0, onRecycle: (r) => reasons.push(r) });
    const t = Date.now();
    await expect(sql`select pg_sleep(3)`).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(2000);
    expect(reasons).toEqual(["stall"]);
    expect((await sql`select 1 as ok`)[0].ok).toBe(1);
  });

  it("오래 쉰 연결 묶음은 다음 쿼리 전에 새로 만든다", async () => {
    let clock = 0;
    const reasons: string[] = [];
    const { client: sql } = createResilientClient(make, { stallMs: 5000, idleRecycleMs: 1000, now: () => clock, onRecycle: (r) => reasons.push(r) });
    await sql`select 1`;
    clock += 500;
    await sql`select 1`;
    expect(reasons).toEqual([]);
    clock += 5000;
    await sql`select 1`;
    expect(reasons).toEqual(["idle"]);
  });
});
