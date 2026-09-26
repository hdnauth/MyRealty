import { NextResponse } from "next/server";
import { health } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** 배포 점검용(공개). 비밀값·오류 메시지는 내보내지 않는다. */
export async function GET() {
  const h = await health();
  const ok = h.db === "ok" && !h.migrations?.pending.length && h.authSecret;
  return NextResponse.json(
    {
      ok,
      db: h.db,
      dbError: h.dbError,
      pendingMigrations: h.migrations?.pending ?? null,
      dbRttMs: h.dbRttMs ?? null,
      region: h.region,
      authSecret: h.authSecret,
      smtp: h.smtp,
      adminEmails: h.adminEmails > 0,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
