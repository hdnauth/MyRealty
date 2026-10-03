import "server-only";
import { isAdminEmail } from "./auth/policy";
import type { User } from "./auth/session";
import { sql } from "./db";
import { shouldPrepare } from "./db-config";
import { env } from "./env";

export async function audit(admin: User, action: string, target: string | null, detail?: Record<string, unknown>) {
  await sql`insert into admin_audit_log (admin_id, admin_email, action, target, detail)
            values (${admin.id}, ${admin.email}, ${action}, ${target}, ${detail ? sql.json(detail as never) : null})`;
}

export type AdminUserRow = {
  id: string;
  /** 기기 게스트는 null */
  email: string | null;
  display_name: string | null;
  role: "user" | "admin";
  status: "active" | "blocked";
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  items: number;
  sessions: number;
  ai_cost: number;
};

export function envAdmin(email: string | null) {
  return email !== null && isAdminEmail(email, env.adminEmails);
}

/** kind: member(이메일 가입, 기본) · guest(기기 게스트) · all */
export type UserFilter = { q?: string; status?: string; role?: string; kind?: string; page?: number };
export const USERS_PAGE_SIZE = 50;

export async function listUsers(f: UserFilter) {
  const q = f.q?.trim().toLowerCase() || null;
  const status = f.status === "active" || f.status === "blocked" ? f.status : null;
  const role = f.role === "admin" || f.role === "user" ? f.role : null;
  const kind = f.kind === "guest" || f.kind === "all" ? f.kind : "member";
  const page = Math.max(1, f.page ?? 1);
  const where = sql`
    where (${kind} = 'all' or (u.email is null) = (${kind} = 'guest'))
      and (${q}::text is null or u.email like '%' || ${q}::text || '%' or lower(coalesce(u.display_name, '')) like '%' || ${q}::text || '%')
      and (${status}::text is null or u.status = ${status}::text)
      and (${role}::text is null or u.role = ${role}::text or (${role}::text = 'admin' and u.email = any(${env.adminEmails}::text[])))`;
  const [[{ n }], rows] = await Promise.all([
    sql<{ n: number }[]>`select count(*)::int as n from users u ${where}`,
    sql<AdminUserRow[]>`
      select u.id, u.email, u.display_name, u.role, u.status, u.created_at::text, u.last_login_at::text,
             (select max(s.last_seen_at) from sessions s where s.user_id = u.id)::text as last_seen_at,
             (select count(*) from watch_items w where w.user_id = u.id)::int as items,
             (select count(*) from sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now())::int as sessions,
             (select coalesce(sum(a.cost_usd), 0) from ai_usage a
               where a.user_id = u.id and a.created_at >= date_trunc('month', now()))::float8 as ai_cost
      from users u ${where}
      order by u.created_at desc
      limit ${USERS_PAGE_SIZE} offset ${(page - 1) * USERS_PAGE_SIZE}`,
  ]);
  return { total: n, rows, page };
}

export async function siteStats() {
  const [u] = await sql<{ total: number; guests: number; active: number; blocked: number; admins: number; new7: number; new30: number; seen1: number; seen7: number }[]>`
    select count(*) filter (where email is not null)::int as total,
           count(*) filter (where email is null)::int as guests,
           count(*) filter (where status = 'active')::int as active,
           count(*) filter (where status = 'blocked')::int as blocked,
           count(*) filter (where role = 'admin' or email = any(${env.adminEmails}::text[]))::int as admins,
           count(*) filter (where email is not null and created_at > now() - interval '7 days')::int as new7,
           count(*) filter (where email is not null and created_at > now() - interval '30 days')::int as new30,
           count(*) filter (where exists (select 1 from sessions s where s.user_id = users.id and s.last_seen_at > now() - interval '1 day'))::int as seen1,
           count(*) filter (where exists (select 1 from sessions s where s.user_id = users.id and s.last_seen_at > now() - interval '7 days')
                               or last_login_at > now() - interval '7 days')::int as seen7
    from users`;
  const [c] = await sql<{ items: number; notifications7: number; sessions: number; reports: number; ai_cost: number; ai_calls: number; logins7: number }[]>`
    select (select count(*) from watch_items)::int as items,
           (select count(*) from notifications where created_at > now() - interval '7 days')::int as notifications7,
           (select count(*) from sessions where revoked_at is null and expires_at > now())::int as sessions,
           (select count(*) from ai_reports)::int as reports,
           (select coalesce(sum(cost_usd), 0) from ai_usage where created_at >= date_trunc('month', now()))::float8 as ai_cost,
           (select count(*) from ai_usage where created_at >= date_trunc('month', now()))::int as ai_calls,
           (select count(*) from otp_codes where consumed_at is not null and code_hash <> 'denied'
              and created_at > now() - interval '7 days')::int as logins7`;
  const signups = await sql<{ d: string; n: number }[]>`
    select to_char(d, 'YYYY-MM-DD') as d, coalesce(x.n, 0)::int as n
    from generate_series(current_date - 29, current_date, interval '1 day') d
    left join (select created_at::date as day, count(*) as n from users where email is not null group by 1) x on x.day = d::date
    order by d`;
  return { users: u, counts: c, signups };
}

export type Health = {
  db: "ok" | "error";
  dbError?: string;
  migrations: { applied: string[]; pending: string[] } | null;
  authSecret: boolean;
  smtp: boolean;
  adminEmails: number;
  /** 웹 서버 ↔ DB 왕복 시간(ms, 3회 중앙값). 수십 ms 를 넘으면 두 곳의 지역이 다를 가능성이 크다 */
  dbRttMs?: number;
  /** 웹 함수가 실행된 지역(Vercel 은 VERCEL_REGION, 예: icn1) */
  region: string | null;
  /** 쿼리당 왕복 수를 줄이는 prepared statement 사용 여부(트랜잭션 풀러면 꺼짐) */
  prepare: boolean;
};

/** DB 왕복 시간: select 1 을 3번 보내 중앙값. 첫 연결 비용이 섞이지 않도록 한 번 먼저 보낸다 */
async function dbRtt(): Promise<number> {
  await sql`select 1`;
  const ts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await sql`select 1`;
    ts.push(performance.now() - t);
  }
  return Math.round(ts.sort((a, b) => a - b)[1] * 10) / 10;
}

/** 빌드 시점에 next.config.ts 가 넣어 둔 db/migrations 목록(없으면 null) — schema_migrations 와 비교 */
function migrationFiles(): string[] | null {
  const list = process.env.MIGRATION_FILES;
  return list ? list.split(",") : null;
}

export async function health(): Promise<Health> {
  const base = {
    authSecret: Boolean(env.authSecret),
    smtp: Boolean(env.smtp.host),
    adminEmails: env.adminEmails.length,
    region: process.env.VERCEL_REGION ?? null,
    prepare: shouldPrepare(env.databaseUrl, process.env.DATABASE_PREPARE),
  };
  try {
    const applied = (await sql<{ name: string }[]>`select name from schema_migrations order by name`).map((r) => r.name);
    const files = migrationFiles();
    const dbRttMs = await dbRtt();
    return { ...base, db: "ok", dbRttMs, migrations: { applied, pending: files ? files.filter((f) => !applied.includes(f)) : [] } };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    return { ...base, db: "error", dbError: code ?? (e instanceof Error ? e.name : "error"), migrations: null };
  }
}

// ───────── 이용 지표(개요) ─────────

export type UsageStats = {
  /** 하루 단위 접속 기록이 시작된 날(0018 마이그레이션 이후 쌓인다) */
  since: string | null;
  dau: number;
  wau: number;
  mau: number;
  /** 최근 60일에 생긴 사용자(게스트 포함) 코호트 */
  cohort: {
    users: number;
    withItem: number;
    members: number;
    /** 사용자 생성 → 첫 관심 부동산까지(분, 중위) */
    minutesToFirstItem: number | null;
    /** 생긴 지 7일 넘은 사용자 중 7일째 이후 다시 접속한 비율의 분모·분자 */
    d7Eligible: number;
    d7Returned: number;
  };
  weeks: { week: string; newUsers: number; active: number }[];
  notifications: { total: number; read: number; opened: number; pushed: number; emailed: number };
  byKind: { kind: string; total: number; opened: number }[];
  features: { finance: number; regionRequests: number; groups: Record<string, number> };
};

export async function usageStats(): Promise<UsageStats> {
  const today = sql`(now() at time zone 'Asia/Seoul')::date`;
  const [[act], [co], weeks, [nt], byKind, [ft], groups] = await Promise.all([
    sql<{ since: string | null; dau: number; wau: number; mau: number }[]>`
      select min(day)::text as since,
        count(distinct user_id) filter (where day = ${today})::int as dau,
        count(distinct user_id) filter (where day > ${today} - 7)::int as wau,
        count(distinct user_id) filter (where day > ${today} - 30)::int as mau
      from user_active_days`,
    sql<UsageStats["cohort"][]>`
      with c as (
        select u.id, u.email, u.created_at,
          (select min(w.created_at) from watch_items w where w.user_id = u.id) as first_item
        from users u where u.created_at > now() - interval '60 days'
      )
      select count(*)::int as users,
        count(*) filter (where first_item is not null)::int as "withItem",
        count(*) filter (where email is not null)::int as members,
        (percentile_cont(0.5) within group (order by extract(epoch from first_item - created_at) / 60)
          filter (where first_item is not null))::float8 as "minutesToFirstItem",
        count(*) filter (where created_at <= now() - interval '7 days')::int as "d7Eligible",
        count(*) filter (where created_at <= now() - interval '7 days' and (
          exists (select 1 from user_active_days a where a.user_id = c.id and a.day >= (c.created_at at time zone 'Asia/Seoul')::date + 7)
          or exists (select 1 from sessions s where s.user_id = c.id and s.last_seen_at >= c.created_at + interval '7 days')))::int as "d7Returned"
      from c`,
    sql<{ week: string; newUsers: number; active: number }[]>`
      select to_char(w, 'MM.DD') as week,
        (select count(*) from users u where u.created_at >= w and u.created_at < w + interval '7 days')::int as "newUsers",
        (select count(distinct a.user_id) from user_active_days a where a.day >= w::date and a.day < w::date + 7)::int as active
      from generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') w
      order by w`,
    sql<UsageStats["notifications"][]>`
      select count(*)::int as total, count(read_at)::int as read, count(opened_at)::int as opened,
        count(pushed_at)::int as pushed, count(emailed_at)::int as emailed
      from notifications where created_at > now() - interval '30 days'`,
    sql<UsageStats["byKind"]>`
      select kind, count(*)::int as total, count(opened_at)::int as opened
      from notifications where created_at > now() - interval '30 days' group by kind order by count(*) desc limit 8`,
    sql<{ finance: number; regionRequests: number }[]>`
      select (select count(*) from users where settings ? 'finance')::int as finance,
        (select count(*) from region_requests where created_at > now() - interval '30 days')::int as "regionRequests"`,
    sql<{ group_tag: string; n: number }[]>`select group_tag, count(*)::int as n from watch_items group by 1`,
  ]);
  return {
    since: act?.since ?? null,
    dau: act?.dau ?? 0,
    wau: act?.wau ?? 0,
    mau: act?.mau ?? 0,
    cohort: co,
    weeks,
    notifications: nt,
    byKind,
    features: { finance: ft.finance, regionRequests: ft.regionRequests, groups: Object.fromEntries(groups.map((g) => [g.group_tag, g.n])) },
  };
}

// ───────── 수집 지역 ─────────

export type TargetRow = {
  sgg_cd: string;
  name: string | null;
  enabled: boolean;
  created_at: string;
  backfilled_to: string | null;
  backfill_months: number;
  items: number;
  requests: number;
  trades: number;
  last_deal: string | null;
  indicators: boolean;
};

export type RegionRequestRow = { id: number; sgg_cd: string; name: string | null; status: "enabled" | "pending" | "rejected"; created_at: string; email: string | null; same: number };

export async function regionAdmin() {
  const [targets, pending, recent] = await Promise.all([
    sql<TargetRow[]>`
      select t.sgg_cd, t.name, t.enabled, t.created_at::text, t.backfilled_to::text, t.backfill_months,
        (select count(*) from watch_items w where w.sgg_cd = t.sgg_cd)::int as items,
        (select count(*) from region_requests r where r.sgg_cd = t.sgg_cd)::int as requests,
        coalesce(x.n, 0)::int as trades, x.last_deal::text as last_deal,
        exists (select 1 from series s where s.code = 'ind.temp.' || t.sgg_cd) as indicators
      from collect_targets t
      left join lateral (select count(*) as n, max(deal_date) as last_deal from transactions where sgg_cd = t.sgg_cd) x on true
      order by t.enabled desc, t.created_at desc`,
    // 대기 요청: 시군구별로 묶어 가장 오래된 요청 하나와 요청 수
    sql<RegionRequestRow[]>`
      select distinct on (r.sgg_cd) r.id::int, r.sgg_cd, r.name, r.status, r.created_at::text, u.email,
        (select count(*) from region_requests r2 where r2.sgg_cd = r.sgg_cd and r2.status = 'pending')::int as same
      from region_requests r left join users u on u.id = r.user_id
      where r.status = 'pending' order by r.sgg_cd, r.created_at`,
    sql<RegionRequestRow[]>`
      select r.id::int, r.sgg_cd, r.name, r.status, r.created_at::text, u.email, 1 as same
      from region_requests r left join users u on u.id = r.user_id
      order by r.created_at desc limit 30`,
  ]);
  return { targets, pending, recent, cap: env.regionTargetCap, enabled: targets.filter((t) => t.enabled).length };
}
