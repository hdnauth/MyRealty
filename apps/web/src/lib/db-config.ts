/**
 * Supabase·Neon 등 트랜잭션 풀러(pgbouncer)는 prepared statement 를 지원하지 않아
 * "prepared statement ... already exists" 오류가 난다. DATABASE_PREPARE=false 로 끄거나,
 * 풀러 주소(6543 포트·pgbouncer=true·pooler 호스트)면 자동으로 끈다.
 */
export function shouldPrepare(url: string, flag: string | undefined): boolean {
  if (flag === "false") return false;
  if (flag === "true") return true;
  return !/:6543(\/|\?|$)|pgbouncer=true|\.pooler\./i.test(url);
}
