import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export type MapPoint = {
  key: string;
  kind: "complex" | "region";
  complex_id: number | null;
  name: string;
  lng: number;
  lat: number;
  n: number;
  median_price: number;
  median_ppy: number | null; // 평당가(만원)
  last_date: string;
};

const TYPES = new Set(["apt", "officetel", "rowhouse", "house", "land", "commercial"]);

/** 화면 영역(bbox) 안의 최근 매매를 단지(또는 읍면동) 단위로 집계 */
export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const bbox = (sp.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) return NextResponse.json({ error: "bbox" }, { status: 400 });
  const [minx, miny, maxx, maxy] = bbox;
  const type = TYPES.has(sp.get("type") ?? "") ? sp.get("type")! : "apt";
  const months = Math.min(Math.max(Number(sp.get("months") ?? 6), 1), 60);
  const kind = sp.get("kind") === "jeonse" ? "jeonse" : "sale";
  const envelope = sql`ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 4326)`;
  const since = sql`current_date - ${`${months} months`}::interval`;

  const complexTypes = new Set(["apt", "officetel", "rowhouse"]);
  const points = complexTypes.has(type)
    ? await sql<MapPoint[]>`
        select 'c' || c.id as key, 'complex' as kind, c.id as complex_id, c.name,
          ST_X(c.geom) as lng, ST_Y(c.geom) as lat, count(*)::int as n,
          percentile_cont(0.5) within group (order by t.price)::float8 as median_price,
          percentile_cont(0.5) within group (order by t.price / nullif(t.area_m2 / 3.305785, 0))::float8 as median_ppy,
          max(t.deal_date)::text as last_date
        from transactions t join complexes c on c.id = t.complex_id
        where t.property_type = ${type} and t.deal_kind = ${kind} and not t.is_canceled and t.deal_date >= ${since}
          and c.geom && ${envelope}
        group by c.id
        order by n desc
        limit 400`
    : await sql<MapPoint[]>`
        select 'r' || r.lawd_cd as key, 'region' as kind, null::bigint as complex_id, coalesce(r.emd, t0.umd_nm) as name,
          ST_X(r.center) as lng, ST_Y(r.center) as lat, t0.n, t0.median_price, t0.median_ppy, t0.last_date
        from (
          select t.lawd_cd, min(t.umd_nm) as umd_nm, count(*)::int as n,
            percentile_cont(0.5) within group (order by t.price)::float8 as median_price,
            percentile_cont(0.5) within group (order by t.price / nullif(coalesce(t.area_m2, t.land_area_m2) / 3.305785, 0))::float8 as median_ppy,
            max(t.deal_date)::text as last_date
          from transactions t
          where t.property_type = ${type} and t.deal_kind = ${kind} and not t.is_canceled and t.deal_date >= ${since}
            and t.lawd_cd is not null
          group by t.lawd_cd
        ) t0 join regions r on r.lawd_cd = t0.lawd_cd
        where r.center && ${envelope}
        limit 400`;
  return NextResponse.json({ points });
}
