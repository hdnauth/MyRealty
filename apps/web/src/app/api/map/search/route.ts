import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { geocode } from "@/lib/external/geocode";

export type MapSearchResult =
  | { kind: "complex"; id: number; name: string; property_type: string; area: string | null; lng: number; lat: number }
  | { kind: "place"; label: string; sub: string | null; lng: number; lat: number };

/**
 * 지도 검색: 수집된 단지명·읍면동 이름(입력 중에 바로) + geo=1 이면 주소 지오코딩(엔터·'주소로 찾기' — 외부 API 라 입력마다 부르지 않는다).
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ results: [] });
  const like = `%${q.replace(/\s+/g, "%")}%`;
  const [complexes, places] = await Promise.all([
    sql<{ id: number; name: string; property_type: string; area: string | null; lng: number; lat: number }[]>`
      select c.id::int as id, c.name, c.property_type, nullif(concat_ws(' ', t.name, c.umd_nm), '') as area,
        ST_X(c.geom) as lng, ST_Y(c.geom) as lat
      from complexes c left join collect_targets t on t.sgg_cd = c.sgg_cd
      where c.geom is not null and (c.name ilike ${like} or c.name_norm ilike ${like} or (coalesce(c.umd_nm, '') || ' ' || c.name) ilike ${like})
      order by (c.name ilike ${`${q}%`}) desc, (c.property_type = 'apt') desc, c.households desc nulls last, c.name
      limit 8`,
    sql<{ label: string; sub: string | null; lng: number; lat: number }[]>`
      select r.emd as label, nullif(concat_ws(' ', r.sido, r.sigungu, t.name), '') as sub, ST_X(r.center) as lng, ST_Y(r.center) as lat
      from regions r left join collect_targets t on t.sgg_cd = substr(r.lawd_cd, 1, 5)
      where r.center is not null and r.level = 3 and (coalesce(t.name, '') || ' ' || coalesce(r.emd, '')) ilike ${like}
      order by (r.emd ilike ${`${q}%`}) desc, length(r.emd)
      limit 4`,
  ]);
  const results: MapSearchResult[] = [
    ...places.map((p) => ({ kind: "place" as const, ...p })),
    ...complexes.map((c) => ({ kind: "complex" as const, ...c })),
  ];
  if (req.nextUrl.searchParams.get("geo") === "1") {
    const pt = await geocode(q).catch(() => null);
    if (pt) results.unshift({ kind: "place", label: q, sub: "주소 위치", lng: pt[0], lat: pt[1] });
  }
  return NextResponse.json({ results });
}
