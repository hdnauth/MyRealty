import { NextResponse, type NextRequest } from "next/server";
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
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ skipped: "ANTHROPIC_API_KEY 미설정" });
  const kind: ReportKind = req.nextUrl.searchParams.get("kind") === "monthly" ? "monthly" : "weekly";
  const users = await sql<{ id: string; email: string; settings: { emailDigest?: boolean } }[]>`
    select distinct u.id, u.email, u.settings from users u join watch_items w on w.user_id = u.id`;
  const results = [];
  for (const u of users) {
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
