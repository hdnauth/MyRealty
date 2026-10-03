import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ensureUser, getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

const Sub = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export async function POST(req: NextRequest) {
  const parsed = Sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  // 로그인 없이도 이 기기로 알림을 받을 수 있다(기기 게스트)
  const user = await ensureUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "잠시 후 다시 시도하세요." }, { status: 429 });
  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  await sql`
    insert into push_subscriptions (endpoint, user_id, keys, user_agent)
    values (${parsed.data.endpoint}, ${user.id}, ${sql.json(parsed.data.keys)}, ${ua})
    on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body?.endpoint === "string") {
    await sql`delete from push_subscriptions where endpoint = ${body.endpoint} and user_id = ${user.id}`;
  }
  return NextResponse.json({ ok: true });
}
