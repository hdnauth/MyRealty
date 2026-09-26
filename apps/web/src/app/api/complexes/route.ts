import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

/** 주소 후보에 해당하는 단지 + 단지의 거래 면적 목록 */
export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  const sgg = sp.get("sgg") ?? "";
  const umd = sp.get("umd") ?? "";
  const jibun = sp.get("jibun") ?? "";
  const type = sp.get("type") ?? "apt";

  const complexes = id
    ? await sql<{ id: number; name: string; property_type: string; build_year: number | null; households: number | null }[]>`
        select id, name, property_type, build_year, households from complexes where id = ${Number(id)}`
    : await sql<{ id: number; name: string; property_type: string; build_year: number | null; households: number | null }[]>`
        select id, name, property_type, build_year, households from complexes
        where sgg_cd = ${sgg} and property_type = ${type}
          and (jibun = ${jibun} or (${umd} <> '' and umd_nm = ${umd.split(" ").at(-1) ?? umd} and jibun = ${jibun}))
        order by households desc nulls last limit 5`;

  const areas = complexes.length
    ? await sql<{ area: number; n: number }[]>`
        select round(area_m2::numeric, 1)::float8 as area, count(*)::int as n from transactions
        where complex_id = ${complexes[0].id} and area_m2 is not null
        group by 1 order by 1`
    : [];
  return NextResponse.json({ complexes, areas });
}
