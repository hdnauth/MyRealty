import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { REMEMBER_DAYS, SESSION_COOKIE, shouldRenew } from "@/lib/auth/policy";

// /api/cron·/api/relay 는 라우트에서 CRON_SECRET 으로 인증한다. /legal·/.well-known 은 앱 마켓 심사·Android 앱 인증용 공개 경로
const PUBLIC_PATHS = ["/login", "/manifest.webmanifest", "/sw.js", "/offline", "/legal", "/.well-known", "/api/cron", "/api/relay", "/api/health"];

function secretKey() {
  const secret = process.env.AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "dev-only-insecure-secret-change-me" : "");
  return secret ? new TextEncoder().encode(secret) : null;
}

/**
 * 서명만 빠르게 확인해 비로그인 사용자를 /login 으로 보낸다. 세션 폐기·계정 정지 여부는 페이지에서 DB 로 재확인.
 * "이 기기 기억하기" 세션은 하루에 한 번 쿠키를 새로 발급해 만료를 연장한다(자동 로그인 유지).
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

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

  if (payload) {
    const res = NextResponse.next();
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
    return res;
  }
  if (isPublic) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
};
