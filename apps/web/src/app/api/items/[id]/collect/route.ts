import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";
import { collectRunner, latestRun, requestCollect } from "@/lib/collect";
import { sql } from "@/lib/db";

async function ownItem(req: NextRequest, ctx: RouteContext<"/api/items/[id]/collect">) {
  const user = await getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: NextResponse.json({ error: "id" }, { status: 400 }) };
  const [own] = await sql`select 1 from watch_items where id = ${id} and user_id = ${user.id}`;
  if (!own) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { id };
}

/** 개별 수집 진행 상황(화면이 몇 초마다 읽는다) */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/items/[id]/collect">) {
  const r = await ownItem(req, ctx);
  if (r.error) return r.error;
  return NextResponse.json({ run: await latestRun(r.id), runner: collectRunner() }, { headers: { "Cache-Control": "no-store" } });
}

/** 개별 수집 요청: body {mode: "auto" | "manual"} */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/collect">) {
  const r = await ownItem(req, ctx);
  if (r.error) return r.error;
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const res = await requestCollect(r.id, body.mode === "manual" ? "manual" : "auto");
  return NextResponse.json(res);
}
