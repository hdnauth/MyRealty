import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { jibunOf, searchJuso } from "@/lib/external/juso";
import { parseDongList } from "@/lib/units";

export type AddressCandidate = {
  source: "juso" | "local";
  roadAddr: string | null;
  jibunAddr: string;
  lawdCd: string | null;
  sggCd: string;
  sidoName: string | null;
  sggName: string | null;
  emdName: string | null;
  jibun: string | null;
  mountain: boolean;
  bonbun: number | null;
  bubun: number | null;
  buildingName: string | null;
  isApartment: boolean;
  complexId: number | null;
  complexType: string | null;
  /** 도로명주소의 상세건물명(주거동만) */
  dongs: string[];
};

type LocalComplex = {
  id: number;
  name: string;
  property_type: string;
  sgg_cd: string;
  lawd_cd: string | null;
  umd_nm: string | null;
  jibun: string | null;
  road_address: string | null;
  sgg_name: string | null;
};

const lastToken = (s: string | null) => (s ?? "").trim().split(/\s+/).at(-1) ?? "";

/**
 * 주소 검색: 도로명주소 API(키가 있을 때) + 로컬 DB 단지명 검색.
 * 도로명주소 결과가 이미 수집된 단지와 같은 필지면 단지 정보를 붙이고 로컬 중복 결과는 뺀다.
 */
export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const results: AddressCandidate[] = [];
  let jusoError: string | null = null;
  try {
    const juso = await searchJuso(q, 10);
    for (const j of juso ?? []) {
      const mountain = j.mtYn === "1";
      results.push({
        source: "juso",
        roadAddr: j.roadAddr,
        jibunAddr: j.jibunAddr,
        lawdCd: j.admCd,
        sggCd: j.admCd.slice(0, 5),
        sidoName: j.siNm,
        sggName: j.sggNm,
        emdName: [j.emdNm, j.liNm].filter(Boolean).join(" "),
        jibun: jibunOf(j),
        mountain,
        bonbun: Number(j.lnbrMnnm),
        bubun: Number(j.lnbrSlno),
        buildingName: j.bdNm || null,
        isApartment: j.bdKdcd === "1",
        complexId: null,
        complexType: null,
        dongs: parseDongList(j.detBdNmList),
      });
    }
  } catch (e) {
    jusoError = e instanceof Error ? e.message : String(e);
  }

  // 도로명주소 결과 ↔ 수집된 단지(같은 시군구·읍면동·지번)
  const usedLocal = new Set<number>();
  if (results.length) {
    const hits = await sql<LocalComplex[]>`
      select c.id, c.name, c.property_type, c.sgg_cd, c.lawd_cd, c.umd_nm, c.jibun, c.road_address, null::text as sgg_name
      from complexes c
      where c.sgg_cd = any(${[...new Set(results.map((r) => r.sggCd))]}) and c.jibun = any(${[...new Set(results.map((r) => r.jibun ?? ""))]})
      order by c.households desc nulls last`;
    for (const r of results) {
      const c = hits.find((h) => h.sgg_cd === r.sggCd && h.jibun === r.jibun && (!h.umd_nm || h.umd_nm === lastToken(r.emdName)));
      if (!c) continue;
      r.complexId = c.id;
      r.complexType = c.property_type;
      r.buildingName = r.buildingName || c.name;
      usedLocal.add(c.id);
    }
  }

  // 수집된 단지명 검색(키 없이도 동작)
  const like = `%${q.replace(/\s+/g, "%")}%`;
  const local = await sql<LocalComplex[]>`
    select c.id, c.name, c.property_type, c.sgg_cd, c.lawd_cd, c.umd_nm, c.jibun, c.road_address, t.name as sgg_name
    from complexes c left join collect_targets t on t.sgg_cd = c.sgg_cd
    where c.name ilike ${like} or (coalesce(c.umd_nm, '') || ' ' || coalesce(c.jibun, '')) ilike ${like}
    order by c.households desc nulls last, c.name
    limit 10`;
  for (const c of local) {
    if (usedLocal.has(c.id)) continue;
    const m = (c.jibun ?? "").match(/^(산\s*)?(\d+)(?:-(\d+))?$/);
    results.push({
      source: "local",
      roadAddr: c.road_address,
      jibunAddr: [c.sgg_name, c.umd_nm, c.jibun].filter(Boolean).join(" "),
      lawdCd: c.lawd_cd,
      sggCd: c.sgg_cd,
      sidoName: null,
      sggName: c.sgg_name,
      emdName: c.umd_nm,
      jibun: c.jibun,
      mountain: Boolean(m?.[1]),
      bonbun: m ? Number(m[2]) : null,
      bubun: m ? Number(m[3] ?? 0) : null,
      buildingName: c.name,
      isApartment: c.property_type === "apt",
      complexId: c.id,
      complexType: c.property_type,
      dongs: [],
    });
  }
  return NextResponse.json({ results, jusoError, jusoEnabled: Boolean(process.env.JUSO_KEY) });
}
