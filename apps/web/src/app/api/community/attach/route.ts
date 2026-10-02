import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { isSgg } from "@/lib/community/rules";

/** 글쓰기 첨부 후보: 단지 최근 거래, 시군구 지표 */
export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const complexId = Number(req.nextUrl.searchParams.get("complex")) || null;
  let sgg = req.nextUrl.searchParams.get("sgg");
  const trades = complexId
    ? await sql`
        select id, deal_kind, deal_date::text, price, monthly_rent, area_m2::float8 as area_m2, floor from transactions
        where complex_id = ${complexId} and not is_canceled order by deal_date desc, id desc limit 40`
    : [];
  if (complexId) {
    const [c] = await sql<{ sgg: string }[]>`select sgg_cd as sgg from complexes where id = ${complexId}`;
    sgg = c?.sgg ?? null;
  }
  const series = isSgg(sgg)
    ? await sql`
        select s.code, s.name from series s
        where s.code = any(${["idx", "vol", "med84", "jr", "jgap", "nhr", "dr"].map((k) => `${k}.${sgg}`).concat(["temp", "burden", "pir", "turnover", "supply"].map((k) => `ind.${k}.${sgg}`))})
          and exists (select 1 from series_values v where v.code = s.code)
        order by s.code`
    : [];
  const macro = await sql`select code, name from series where code in ('ecos.base_rate', 'ecos.mortgage_rate') and exists (select 1 from series_values v where v.code = series.code)`;
  return NextResponse.json({ trades, series: [...series, ...macro] });
}
