import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

/** 푸시 알림을 눌러 들어왔을 때(서비스 워커가 tag "n{id}" 로 보낸다): 읽음 + 열람 기록 */
export async function POST(req: NextRequest) {
  const user = await getUser();
  const id = Number((await req.json().catch(() => ({})))?.id);
  if (!user || !Number.isSafeInteger(id)) return NextResponse.json({ ok: false });
  await sql`update notifications set read_at = coalesce(read_at, now()), opened_at = coalesce(opened_at, now())
            where id = ${id} and user_id = ${user.id}`;
  return NextResponse.json({ ok: true });
}
