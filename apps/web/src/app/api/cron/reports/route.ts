import { NextResponse, type NextRequest } from "next/server";
import { resolveAi } from "@/lib/ai/client";
import { emailReport, generateReport, type ReportKind } from "@/lib/ai/reports";
import { sql } from "@/lib/db";

export const maxDuration = 300;

/**
 * 정기 리포트 생성(스케줄러가 호출). Authorization: Bearer $CRON_SECRET
 * GitHub Actions: curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/reports?kind=weekly"
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // 키 점검(myrealty doctor): GitHub 의 CRON_SECRET 이 웹과 같은지만 확인하고 리포트는 만들지 않는다
  if (req.nextUrl.searchParams.get("kind") === "check") return NextResponse.json({ ok: true });
  const kind: ReportKind = req.nextUrl.searchParams.get("kind") === "monthly" ? "monthly" : "weekly";
  // AI 리포트·메일은 이메일로 가입한 사용자만(기기 게스트 제외)
  const users = await sql<{ id: string; email: string; settings: { emailDigest?: boolean } }[]>`
    select distinct u.id, u.email, u.settings from users u join watch_items w on w.user_id = u.id
    where u.status = 'active' and u.email is not null`;
  const results = [];
  for (const u of users) {
    // 사용자별 AI 설정(본인 키) → 없으면 서버 기본(ANTHROPIC_API_KEY). 둘 다 없으면 건너뛴다
    if (!(await resolveAi(u.id)).cfg) {
      results.push({ user: u.id, skipped: "AI 설정 없음" });
      continue;
    }
    try {
      const r = await generateReport(u.id, kind);
      if (u.settings?.emailDigest !== false) await emailReport(u.email, r.title, r.md, r.snap.portfolio.value);
      results.push({ user: u.id, report: r.id });
    } catch (e) {
      results.push({ user: u.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ kind, results });
}
