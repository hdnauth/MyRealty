import "server-only";
import postgres from "postgres";
import { maxPipeline, shouldPrepare } from "./db-config";
import { createResilientClient } from "./db-resilient";
import { env } from "./env";

declare global {
  var __mrSql: postgres.Sql | undefined;
}

// int8·numeric 을 JS number 로 받는다(금액은 만원 단위라 안전 범위 내).
const toNumber = (x: string) => Number(x);

// 서버리스(Vercel)에서는 쉬는 연결을 빨리 닫고, 오래 쉰 연결 묶음·멈춘 쿼리는 새 연결로 바꾼다(db-resilient.ts 참고)
const serverless = Boolean(process.env.VERCEL);

const pipeline = maxPipeline(env.databaseUrl, process.env.DATABASE_PIPELINE);

const makeClient = () =>
  postgres(env.databaseUrl, {
    max: 5,
    idle_timeout: serverless ? 10 : 20,
    prepare: shouldPrepare(env.databaseUrl, process.env.DATABASE_PREPARE),
    // postgres.js 는 키가 있으면 undefined·null 도 그대로 쓴다 — 값이 있을 때만 넣는다
    // 풀러(Supabase)에서는 파이프라이닝을 끈다 — 트랜잭션 풀러에서 쿼리가 멈추던 원인(db-config.ts)
    ...(pipeline !== undefined ? { max_pipeline: pipeline } : {}),
    // 서버리스: 같은 연결을 너무 오래 쓰지 않는다(풀러가 조용히 끊은 연결을 오래 붙잡지 않게)
    ...(serverless ? { max_lifetime: 5 * 60 } : {}),
    connect_timeout: 10,
    types: {
      int8: { to: 20, from: [20], parse: toNumber, serialize: (x: number) => String(x) },
      numeric: { to: 1700, from: [1700], parse: toNumber, serialize: (x: number) => String(x) },
    },
    transform: { undefined: null },
  });

// 개발 중 HMR 로 연결이 누적되지 않도록 전역에 보관한다.
export const sql: postgres.Sql =
  globalThis.__mrSql ??
  createResilientClient(makeClient, {
    // 지도·지표 쿼리는 길어야 몇 초 — 25초 넘게 끝나지 않으면 연결이 멈춘 것으로 본다
    stallMs: 25_000,
    idleRecycleMs: serverless ? 30_000 : 0,
    onRecycle: (reason) => console.warn(`[db] 연결 묶음을 새로 만듦(${reason === "stall" ? "응답 없는 쿼리" : "오래 쉰 연결"})`),
  }).client;

if (env.isDev) globalThis.__mrSql = sql;
