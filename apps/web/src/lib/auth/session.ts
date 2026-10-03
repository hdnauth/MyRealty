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

/**
 * 세션이 없는 방문자의 사용자 ID 자리. 어떤 행과도 일치하지 않아 "내 데이터" 쿼리가 그대로 빈 결과가 된다.
 * (방문자도 모든 화면을 열람할 수 있게 페이지는 로그인을 요구하지 않는다)
 */
export const NO_USER = "00000000-0000-0000-0000-000000000000";

/** 같은 네트워크에서 한 시간에 만들 수 있는 기기 게스트 수(봇이 계정을 무한히 만들지 못하게) */
const GUEST_PER_IP_HOUR = 20;

export type User = {
  id: string;
  /** 기기 게스트는 null(이메일 간편 가입 전) */
  email: string | null;
  /** 이메일 없이 이 기기에서만 쓰는 계정. 글쓰기·AI 등은 가입해야 한다 */
  isGuest: boolean;
  displayName: string | null;
  settings: UserSettings;
  role: "user" | "admin";
  isAdmin: boolean;
  /** ADMIN_EMAILS 로 지정된 관리자(화면에서 해제·정지 불가) */
  isEnvAdmin: boolean;
  sessionId: string;
  /** 안 읽은 알림 수(레이아웃 배지). 세션 확인과 같은 쿼리로 가져와 DB 왕복을 줄인다 */
  unread: number;
  /** 관심 부동산 수(시작 화면·탭 대상 결정) */
  itemCount: number;
};
export type UserSettings = {
  emailDigest?: boolean;
  digestHour?: number;
  pushEnabled?: boolean;
  instantPriority?: number;
};

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function createSession(userId: string, remember: boolean): Promise<string> {
  const h = await headers();
  const ua = h.get("user-agent")?.slice(0, 300) ?? null;
  const ip = await clientIp();
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
  return s.id;
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
  email: string | null;
  display_name: string | null;
  settings: UserSettings;
  role: "user" | "admin";
  remember: boolean;
  seen_recently: boolean;
  unread: number;
  items: number;
};

/** 현재 요청의 로그인 사용자(세션 폐기·만료·계정 정지까지 DB 로 확인). 요청 단위로 캐시. */
export const getUser = cache(async (): Promise<User | null> => {
  const tok = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!tok) return null;
  const rows = await sql<Row[]>`
    select u.id, u.email, u.display_name, u.settings, u.role, s.remember,
           coalesce(s.last_seen_at > now() - interval '10 minutes', false) as seen_recently,
           (select count(*)::int from notifications n where n.user_id = u.id and n.read_at is null) as unread,
           (select count(*)::int from watch_items w where w.user_id = u.id) as items
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
  const isEnvAdmin = r.email ? isAdminEmail(r.email, env.adminEmails) : false;
  return {
    id: r.id,
    email: r.email,
    isGuest: r.email === null,
    displayName: r.display_name,
    settings: r.settings ?? {},
    role: r.role,
    isAdmin: r.email ? isAdminUser({ email: r.email, role: r.role }, env.adminEmails) : false,
    isEnvAdmin,
    sessionId: tok.sid,
    unread: r.unread,
    itemCount: r.items,
  };
});

/**
 * 서명이 확인된 세션 토큰의 사용자 ID(DB 조회 없음). 화면 쿼리를 세션 확인(getUser)과 동시에 시작해
 * DB 왕복 한 번을 아끼는 용도다. 세션 폐기·계정 정지는 getUser 가 확인하므로 반드시 함께 await 하고,
 * getUser 가 null 이면 결과를 쓰지 않는다:
 *   const uid = await sessionUserId();
 *   const [user, rows] = await Promise.all([getUser(), query(uid)]);
 * 세션이 없으면 NO_USER(빈 결과).
 */
export const sessionUserId = cache(async (): Promise<string> => {
  const tok = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
  return tok?.uid ?? NO_USER;
});

/**
 * 페이지용 사용자 확인(방문자는 null). sessionUserId 로 먼저 시작한 조회와 함께 await 한다.
 * 토큰은 있는데 세션이 폐기·만료되었거나 계정이 정지·삭제되었으면 그 토큰으로 조회한 데이터를 쓰지 않도록
 * 쿠키를 지우는 경로로 보낸다(방문자로 다시 보기).
 */
export async function pageUser(uid: string): Promise<User | null> {
  const user = await getUser();
  if (!user && uid !== NO_USER) redirect("/api/auth/reset");
  return user;
}

/** 가입(로그인) 화면 주소. 돌아올 곳은 지정하지 않으면 요청한 화면(Referer) */
export async function signupHref(next?: string, reason?: string): Promise<string> {
  let back = next;
  if (!back) {
    const ref = (await headers()).get("referer");
    try {
      if (ref) back = new URL(ref).pathname + new URL(ref).search;
    } catch {
      back = undefined;
    }
  }
  const q = new URLSearchParams();
  if (back && back !== "/") q.set("next", back);
  if (reason) q.set("why", reason);
  return `/login${q.size ? `?${q}` : ""}`;
}

/** 이미 있는 내 데이터를 고치는 액션: 세션(게스트 포함)이 있어야 한다 */
export async function requireUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect(await signupHref());
  return u;
}

/**
 * 무언가를 저장하는 액션(관심 등록·구독·설정): 세션이 없으면 이 기기의 게스트 계정을 만들어 이어서 처리한다.
 * 쿠키를 쓰므로 서버 액션·라우트 핸들러에서만 부른다.
 */
export async function ensureUser(): Promise<User> {
  const u = await getUser();
  if (u) return u;
  const ip = await clientIp();
  if (ip) {
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int as n from sessions s join users u on u.id = s.user_id
      where u.email is null and s.ip = ${ip} and s.created_at > now() - interval '1 hour'`;
    if (r.n >= GUEST_PER_IP_HOUR) throw new Error("이 네트워크에서 요청이 너무 많습니다. 잠시 후 다시 시도하거나 이메일로 가입하세요.");
  }
  const [g] = await sql<{ id: string }[]>`insert into users (email, last_login_at) values (null, now()) returning id`;
  const sessionId = await createSession(g.id, true);
  return {
    id: g.id,
    email: null,
    isGuest: true,
    displayName: null,
    settings: {},
    role: "user",
    isAdmin: false,
    isEnvAdmin: false,
    sessionId,
    unread: 0,
    itemCount: 0,
  };
}

/** 이메일 가입이 필요한 기능(글쓰기·AI 등): 방문자·게스트는 가입 화면으로 보낸다 */
export async function requireMember(next?: string): Promise<User & { email: string }> {
  const u = await getUser();
  if (!u || u.email === null) redirect(await signupHref(next, "member"));
  return u as User & { email: string };
}

/** 관리자 전용 화면·액션. 관리자가 아니면 404 로 숨긴다. */
export async function requireAdmin(): Promise<User> {
  const u = await getUser();
  if (!u?.isAdmin) notFound();
  return u;
}

export async function destroySession() {
  const jar = await cookies();
  const tok = await readToken(jar.get(SESSION_COOKIE)?.value);
  if (tok) await sql`update sessions set revoked_at = now() where id = ${tok.sid}`;
  jar.delete(SESSION_COOKIE);
}
