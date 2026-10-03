import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

export const maxDuration = 60;

/**
 * 국내 API 중계(ETL 전용). GitHub Actions 러너(해외)에서 공공데이터포털·브이월드 호출이 거부·차단될 때
 * ETL 이 이 경로로 다시 부른다. 웹은 서울 리전(vercel.json icn1)에서 자기 환경 변수의 키를 붙여 호출하고
 * 응답 본문·상태를 그대로 돌려준다. 허용한 호스트만, Authorization: Bearer $CRON_SECRET.
 *
 *   GET /api/relay?url=https://apis.data.go.kr/1613000/...&LAWD_CD=11110&DEAL_YMD=202608
 */
const HOSTS: Record<string, (q: URLSearchParams) => string | null> = {
  "apis.data.go.kr": (q) => (env.dataGoKrKey ? (q.set("serviceKey", env.dataGoKrKey), null) : "DATA_GO_KR_KEY"),
  "api.odcloud.kr": (q) => (env.dataGoKrKey ? (q.set("serviceKey", env.dataGoKrKey), null) : "DATA_GO_KR_KEY"),
  "api.vworld.kr": (q) => {
    if (!env.vworldKey) return "VWORLD_KEY";
    q.set("key", env.vworldKey);
    if (env.vworldDomain) q.set("domain", env.vworldDomain);
    return null;
  },
  // 정비사업 목록(키 없음): 서울 정보몽땅, 부산 정비사업 통합홈페이지
  "cleanup.seoul.go.kr": () => null,
  "dynamice.busan.go.kr": () => null,
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = new URLSearchParams(req.nextUrl.searchParams);
  const raw = sp.get("url") ?? "";
  sp.delete("url");
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "url" }, { status: 400, headers: { "x-relay": "1" } });
  }
  const addKey = HOSTS[target.hostname];
  if (target.protocol !== "https:" || !addKey) {
    return NextResponse.json({ error: "host not allowed" }, { status: 400, headers: { "x-relay": "1" } });
  }
  for (const k of ["serviceKey", "key", "domain"]) sp.delete(k);
  const missing = addKey(sp);
  if (missing) {
    return NextResponse.json({ error: `웹(Vercel)에 ${missing} 가 없습니다` }, { status: 424, headers: { "x-relay": "1" } });
  }
  target.search = sp.toString();
  try {
    const res = await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(40_000), headers: { "User-Agent": "MyRealty-relay/0.1" } });
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream", "x-relay": "1", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: `중계 호출 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 502, headers: { "x-relay": "1" } });
  }
}
