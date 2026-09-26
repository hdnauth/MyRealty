import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isAdminEmail } from "./auth/policy";
import type { User } from "./auth/session";
import { sql } from "./db";
import { env } from "./env";

export async function audit(admin: User, action: string, target: string | null, detail?: Record<string, unknown>) {
  await sql`insert into admin_audit_log (admin_id, admin_email, action, target, detail)
            values (${admin.id}, ${admin.email}, ${action}, ${target}, ${detail ? sql.json(detail as never) : null})`;
}

export type AdminUserRow = {
  id: string;
  email: string;
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

export function envAdmin(email: string) {
  return isAdminEmail(email, env.adminEmails);
}

export type UserFilter = { q?: string; status?: string; role?: string; page?: number };
export const USERS_PAGE_SIZE = 50;

export async function listUsers(f: UserFilter) {
  const q = f.q?.trim().toLowerCase() || null;
  const status = f.status === "active" || f.status === "blocked" ? f.status : null;
  const role = f.role === "admin" || f.role === "user" ? f.role : null;
  const page = Math.max(1, f.page ?? 1);
  const where = sql`
    where (${q}::text is null or u.email like '%' || ${q}::text || '%' or lower(coalesce(u.display_name, '')) like '%' || ${q}::text || '%')
      and (${status}::text is null or u.status = ${status}::text)
      and (${role}::text is null or u.role = ${role}::text or (${role}::text = 'admin' and u.email = any(${env.adminEmails}::text[])))`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from users u ${where}`;
  const rows = await sql<AdminUserRow[]>`
    select u.id, u.email, u.display_name, u.role, u.status, u.created_at::text, u.last_login_at::text,
           (select max(s.last_seen_at) from sessions s where s.user_id = u.id)::text as last_seen_at,
           (select count(*) from watch_items w where w.user_id = u.id)::int as items,
           (select count(*) from sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now())::int as sessions,
           (select coalesce(sum(a.cost_usd), 0) from ai_usage a
             where a.user_id = u.id and a.created_at >= date_trunc('month', now()))::float8 as ai_cost
    from users u ${where}
    order by u.created_at desc
    limit ${USERS_PAGE_SIZE} offset ${(page - 1) * USERS_PAGE_SIZE}`;
  return { total: n, rows, page };
}

export async function siteStats() {
  const [u] = await sql<{ total: number; active: number; blocked: number; admins: number; new7: number; new30: number; seen1: number; seen7: number }[]>`
    select count(*)::int as total,
           count(*) filter (where status = 'active')::int as active,
           count(*) filter (where status = 'blocked')::int as blocked,
           count(*) filter (where role = 'admin' or email = any(${env.adminEmails}::text[]))::int as admins,
           count(*) filter (where created_at > now() - interval '7 days')::int as new7,
           count(*) filter (where created_at > now() - interval '30 days')::int as new30,
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
    left join (select created_at::date as day, count(*) as n from users group by 1) x on x.day = d::date
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
};

/** db/migrations 폴더(배포 번들에 없을 수 있음)와 schema_migrations 비교 */
async function migrationFiles(): Promise<string[] | null> {
  for (const dir of [path.resolve(process.cwd(), "../../db/migrations"), path.resolve(process.cwd(), "db/migrations")]) {
    try {
      return (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

export async function health(): Promise<Health> {
  const base = { authSecret: Boolean(env.authSecret), smtp: Boolean(env.smtp.host), adminEmails: env.adminEmails.length };
  try {
    const applied = (await sql<{ name: string }[]>`select name from schema_migrations order by name`).map((r) => r.name);
    const files = await migrationFiles();
    return { ...base, db: "ok", migrations: { applied, pending: files ? files.filter((f) => !applied.includes(f)) : [] } };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    return { ...base, db: "error", dbError: code ?? (e instanceof Error ? e.name : "error"), migrations: null };
  }
}
