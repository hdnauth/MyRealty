import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { REMEMBER_DAYS, SESSION_COOKIE, shouldRenew } from "@/lib/auth/policy";

function secretKey() {
  const secret = process.env.AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "dev-only-insecure-secret-change-me" : "");
  return secret ? new TextEncoder().encode(secret) : null;
}

/**
 * 로그인 없이도 모든 화면을 열람할 수 있다(방문자). 저장이 필요한 순간 기기 게스트 계정이 만들어지고,
 * 글쓰기·AI 등은 화면·액션에서 이메일 가입을 요구한다(lib/auth/session). API 라우트는 각자 인증한다.
 * 여기서는 "이 기기 기억하기" 세션(게스트 포함)의 쿠키를 하루에 한 번 새로 발급해 만료를 연장한다.
 */
export async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const key = secretKey();
  let payload: JWTPayload | null = null;
  if (token && key) {
    try {
      payload = (await jwtVerify(token, key, { algorithms: ["HS256"] })).payload;
    } catch {
      payload = null;
    }
  }

  // 시작 화면: 세션이 없는 방문자는 바로 지도로(관심 부동산이 없는 사용자는 홈 화면이 지도로 보낸다)
  if (!payload && req.nextUrl.pathname === "/") return NextResponse.redirect(new URL("/map", req.url));
  const res = NextResponse.next();
  if (payload) {
    if (key && shouldRenew(payload)) {
      const expires = new Date(Date.now() + REMEMBER_DAYS * 86400_000);
      const fresh = await new SignJWT({ uid: payload.uid, rem: true })
        .setProtectedHeader({ alg: "HS256" })
        .setJti(String(payload.jti))
        .setIssuedAt()
        .setExpirationTime(expires)
        .sign(key);
      res.cookies.set(SESSION_COOKIE, fresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires,
      });
    }
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
};
