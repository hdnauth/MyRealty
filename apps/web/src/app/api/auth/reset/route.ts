import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/policy";

/** 폐기·만료된 세션 쿠키를 지우고 처음 화면으로(방문자로 다시 보기). lib/auth/session 의 pageUser 가 보낸다 */
export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
