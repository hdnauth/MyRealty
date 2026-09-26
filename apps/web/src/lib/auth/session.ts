import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sql } from "../db";
import { requireAuthSecret } from "../env";

export const SESSION_COOKIE = "mr_session";
const SESSION_DAYS = 30;

export type User = { id: string; email: string; displayName: string | null; settings: UserSettings };
export type UserSettings = {
  emailDigest?: boolean;
  digestHour?: number;
  pushEnabled?: boolean;
  instantPriority?: number;
};

export async function createSession(userId: string) {
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const [s] = await sql<{ id: string }[]>`
    insert into sessions (user_id, user_agent, expires_at) values (${userId}, ${ua}, ${expires})
    returning id`;
  const token = await new SignJWT({ uid: userId })
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
    expires,
  });
}

export async function readToken(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, requireAuthSecret(), { algorithms: ["HS256"] });
    if (typeof payload.jti !== "string" || typeof payload.uid !== "string") return null;
    return { sid: payload.jti, uid: payload.uid };
  } catch {
    return null;
  }
}

/** 현재 요청의 로그인 사용자(세션 폐기·만료까지 DB 로 확인). 요청 단위로 캐시. */
export const getUser = cache(async (): Promise<User | null> => {
  const tok = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!tok) return null;
  const rows = await sql<{ id: string; email: string; display_name: string | null; settings: UserSettings }[]>`
    select u.id, u.email, u.display_name, u.settings
    from sessions s join users u on u.id = s.user_id
    where s.id = ${tok.sid} and s.user_id = ${tok.uid} and s.revoked_at is null and s.expires_at > now()`;
  const r = rows[0];
  return r ? { id: r.id, email: r.email, displayName: r.display_name, settings: r.settings ?? {} } : null;
});

export async function requireUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

export async function destroySession() {
  const jar = await cookies();
  const tok = await readToken(jar.get(SESSION_COOKIE)?.value);
  if (tok) await sql`update sessions set revoked_at = now() where id = ${tok.sid}`;
  jar.delete(SESSION_COOKIE);
}
