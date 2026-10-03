/**
 * Supabase·Neon 등 트랜잭션 풀러(pgbouncer)는 prepared statement 를 지원하지 않아
 * "prepared statement ... already exists" 오류가 난다. DATABASE_PREPARE=false 로 끄거나,
 * 트랜잭션 풀러 주소(6543 포트·pgbouncer=true·Neon -pooler 호스트)면 자동으로 끈다.
 *
 * 끄면 postgres.js 는 매 쿼리마다 Parse/Describe 로 한 번 더 왕복한다(쿼리당 DB 왕복 2회).
 * Supabase Session pooler(pooler 호스트의 5432 포트)는 세션을 유지해 prepared statement 가 되므로 켠다.
 */
export function shouldPrepare(url: string, flag: string | undefined): boolean {
  if (flag === "false") return false;
  if (flag === "true") return true;
  return !/:6543(\/|\?|$)|pgbouncer=true|-pooler\./i.test(url);
}

/**
 * 쿼리 파이프라이닝(한 연결에 여러 쿼리를 Sync 없이 이어 보내기) 상한. 풀러 주소면 0(끔).
 *
 * Supabase 트랜잭션 풀러(6543)는 쿼리 경계(Sync·ReadyForQuery)를 보고 DB 연결을 나눠 주는데, postgres.js 가 파라미터 없는 쿼리를
 * 이어 보내면 경계를 놓쳐 쿼리가 응답 없이 멈추고(동시 쿼리 13개 시험에서 매번 재현), 멈춘 DB 연결이 다른 요청에 넘어가
 * `select 1` 까지 시간 초과(57014)로 끊겼다 — 운영(Vercel) 화면이 몇 번에 한 번씩 수십 초 멈춘 원인. 끄면 같은 시험에서 멈추지 않는다.
 * 같은 연결에서 쿼리를 하나씩 보내는 대신 연결을 더 쓴다(인스턴스당 최대 5개). DATABASE_PIPELINE=숫자로 덮어쓸 수 있다.
 */
export function maxPipeline(url: string, flag: string | undefined): number | undefined {
  if (flag !== undefined && flag !== "" && Number.isFinite(Number(flag))) return Number(flag);
  return /:6543(\/|\?|$)|pgbouncer=true|-pooler\.|pooler\.supabase\.com/i.test(url) ? 0 : undefined;
}
