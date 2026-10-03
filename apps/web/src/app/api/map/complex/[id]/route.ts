import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(_: Request, ctx: RouteContext<"/api/map/complex/[id]">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id" }, { status: 400 });
  const [complex] = await sql`select id, name, property_type, build_year, households, umd_nm, jibun from complexes where id = ${id}`;
  const trades = await sql`
    select id, deal_kind, deal_date::text as deal_date, price, monthly_rent, area_m2, floor, is_canceled
    from transactions where complex_id = ${id} order by deal_date desc limit 150`;
  // 동네 이야기 글 수(지도 선택 카드의 '이야기' 버튼)
  const [talk] = await sql<{ total: number; recent: number }[]>`
    select count(*)::int as total, count(*) filter (where created_at > now() - interval '7 days')::int as recent
    from community_posts where complex_id = ${id} and status = 'visible'`;
  return NextResponse.json({ complex, trades, talk });
}
