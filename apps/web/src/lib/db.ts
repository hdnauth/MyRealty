import "server-only";
import postgres from "postgres";
import { shouldPrepare } from "./db-config";
import { env } from "./env";

declare global {
  var __mrSql: postgres.Sql | undefined;
}

// int8·numeric 을 JS number 로 받는다(금액은 만원 단위라 안전 범위 내).
const toNumber = (x: string) => Number(x);

// 개발 중 HMR 로 연결이 누적되지 않도록 전역에 보관한다.
export const sql: postgres.Sql =
  globalThis.__mrSql ??
  postgres(env.databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: shouldPrepare(env.databaseUrl, process.env.DATABASE_PREPARE),
    connect_timeout: 10,
    types: {
      int8: { to: 20, from: [20], parse: toNumber, serialize: (x: number) => String(x) },
      numeric: { to: 1700, from: [1700], parse: toNumber, serialize: (x: number) => String(x) },
    },
    transform: { undefined: null },
  });

if (env.isDev) globalThis.__mrSql = sql;
