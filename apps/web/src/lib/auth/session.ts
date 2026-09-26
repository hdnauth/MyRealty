import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { sql } from "../db";
import { env, requireAuthSecret } from "../env";
import { isAdminEmail, isAdminUser, SESSION_COOKIE, sessionExpiry } from "./policy";

export { SESSION_COOKIE };

export type User = {
  id: string;
  email: string;
  displayName: string | null;
  settings: UserSettings;
  role: "user" | "admin";
  isAdmin: boolean;
  /** ADMIN_EMAILS 로 지정된 관리자(화면에서 해제·정지 불가) */
  isEnvAdmin: boolean;
  sessionId: string;
  /** 안 읽은 알림 수(레이아웃 배지). 세션 확인과 같은 쿼리로 가져와 DB 왕복을 줄인다 */
  unread: number;
};
export type UserSettings = {
  emailDigest?: boolean;
  digestHour?: number;
  pushEnabled?: boolean;
  instantPriority?: number;
};

export async function createSession(userId: string, remember: boolean) {
  const h = await headers();
  const ua = h.get("user-agent")?.slice(0, 300) ?? null;
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const expires = sessionExpiry(remember);
  const [s] = await sql<{ id: string }[]>`
    insert into sessions (user_id, user_agent, expires_at, remember, ip, last_seen_at)
    values (${userId}, ${ua}, ${expires}, ${remember}, ${ip}, now())
    returning id`;
  const token = await new SignJWT({ uid: userId, rem: remember })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(s.id)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(requireAuthSecret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // 기억하지 않으면 세션 쿠키(브라우저 종료 시 삭제)
    ...(remember ? { expires } : {}),
  });
}

export async function readToken(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, requireAuthSecret(), { algorithms: ["HS256"] });
    if (typeof payload.jti !== "string" || typeof payload.uid !== "string") return null;
    return { sid: payload.jti, uid: payload.uid, remember: payload.rem === true };
  } catch {
    return null;
  }
}

type Row = {
  id: string;
  email: string;
  display_name: string | null;
  settings: UserSettings;
  role: "user" | "admin";
  remember: boolean;
  seen_recently: boolean;
  unread: number;
};

/** 현재 요청의 로그인 사용자(세션 폐기·만료·계정 정지까지 DB 로 확인). 요청 단위로 캐시. */
export const getUser = cache(async (): Promise<User | null> => {
  const tok = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!tok) return null;
  const rows = await sql<Row[]>`
    select u.id, u.email, u.display_name, u.settings, u.role, s.remember,
           coalesce(s.last_seen_at > now() - interval '10 minutes', false) as seen_recently,
           (select count(*)::int from notifications n where n.user_id = u.id and n.read_at is null) as unread
    from sessions s join users u on u.id = s.user_id
    where s.id = ${tok.sid} and s.user_id = ${tok.uid} and s.revoked_at is null and s.expires_at > now()
      and u.status = 'active'`;
  const r = rows[0];
  if (!r) return null;
  if (!r.seen_recently) {
    // 마지막 접속 기록 + 기억된 기기는 만료를 연장(쿠키는 proxy 가 재발급). 화면에 필요 없으니 응답을 보낸 뒤에 한다.
    const ext = r.remember ? sessionExpiry(true) : null;
    after(async () => {
      await sql`
        update sessions set last_seen_at = now(), expires_at = greatest(expires_at, coalesce(${ext}::timestamptz, expires_at))
        where id = ${tok.sid}`;
    });
  }
  const isEnvAdmin = isAdminEmail(r.email, env.adminEmails);
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    settings: r.settings ?? {},
    role: r.role,
    isAdmin: isAdminUser(r, env.adminEmails),
    isEnvAdmin,
    sessionId: tok.sid,
    unread: r.unread,
  };
});

/**
 * 서명이 확인된 세션 토큰의 사용자 ID(DB 조회 없음). 화면 쿼리를 세션 확인(requireUser)과 동시에 시작해
 * DB 왕복 한 번을 아끼는 용도다. 세션 폐기·계정 정지는 requireUser 가 확인하므로 반드시 함께 await 한다:
 *   const uid = await sessionUserId();
 *   const [user, rows] = await Promise.all([requireUser(), query(uid)]);
 */
export const sessionUserId = cache(async (): Promise<string> => {
  const tok = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!tok) redirect("/login");
  return tok.uid;
});

export async function requireUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

/** 관리자 전용 화면·액션. 관리자가 아니면 404 로 숨긴다. */
export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (!u.isAdmin) notFound();
  return u;
}

export async function destroySession() {
  const jar = await cookies();
  const tok = await readToken(jar.get(SESSION_COOKIE)?.value);
  if (tok) await sql`update sessions set revoked_at = now() where id = ${tok.sid}`;
  jar.delete(SESSION_COOKIE);
}
