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
