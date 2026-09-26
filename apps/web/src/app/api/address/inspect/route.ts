import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { getTitles, getUnits, type TitleRow, toTuples, type UnitInfo } from "@/lib/external/building";
import { landCharacteristics } from "@/lib/external/vworld";
import { isPropertyType, makePnu, PROPERTY_TYPES, type PropertyType } from "@/lib/property";
import { type AreaType, clusterAreas, parseDongList, sortDongs, typeFromJimok, typeFromPurpose, type UnitTuple } from "@/lib/units";

export type InspectResult = {
  pnu: string | null;
  suggestedType: PropertyType | null;
  /** 유형 판별 근거(화면 표시용) */
  typeReason: string | null;
  complex: { id: number; name: string; property_type: string; build_year: number | null; households: number | null } | null;
  building: {
    name: string | null;
    purpose: string | null;
    approvedYear: number | null;
    households: number | null;
    dongCount: number;
    maxFloor: number | null;
    totalArea: number | null;
    platArea: number | null;
  } | null;
  land: { jimok: string | null; area: number | null } | null;
  areaTypes: AreaType[];
  dongs: string[];
  units: UnitTuple[] | null;
  unitsPartial: boolean;
  /** 자동 입력이 안 된 이유(키 미설정·API 오류 등) */
  notes: string[];
};

const HOUSING = /공동주택|아파트|연립|다세대|오피스텔/;

/** 주 건물(연면적이 가장 큰 표제부) */
function mainTitle(titles: TitleRow[]) {
  return titles.reduce<TitleRow | null>((a, b) => (!a || (b.total_area ?? 0) > (a.total_area ?? 0) ? b : a), null);
}

/**
 * 고른 주소의 건물 정보를 모아 등록 화면을 자동으로 채운다.
 * 유형(수집된 단지 → 건축물대장 용도 → 토지특성 지목 → 도로명주소 공동주택 여부), 평형 목록(건축물대장 호별 면적 + 실거래),
 * 동·호 목록, 토지 면적. 외부 API 가 실패해도 가능한 만큼만 채워 돌려준다.
 */
export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const sgg = sp.get("sgg") ?? "";
  const lawd = sp.get("lawd") ?? "";
  const umd = (sp.get("umd") ?? "").trim().split(/\s+/).at(-1) ?? "";
  const jibun = sp.get("jibun") ?? "";
  const mountain = sp.get("mountain") === "1";
  const complexId = Number(sp.get("complexId")) || null;
  const jusoApt = sp.get("apt") === "1";
  const hasBuildingName = Boolean(sp.get("name"));
  const pnu = lawd && sp.get("bonbun") ? makePnu(lawd, mountain, sp.get("bonbun")!, sp.get("bubun") ?? "0") : null;
  const notes: string[] = [];

  // 1) 수집된 단지(실거래가 있는 단지)
  const [complex] = complexId
    ? await sql<NonNullable<InspectResult["complex"]>[]>`
        select id, name, property_type, build_year, households from complexes where id = ${complexId}`
    : sgg && jibun
      ? await sql<NonNullable<InspectResult["complex"]>[]>`
          select id, name, property_type, build_year, households from complexes
          where sgg_cd = ${sgg} and jibun = ${jibun} and (${umd} = '' or umd_nm is null or umd_nm = ${umd})
          order by case property_type when 'apt' then 0 when 'officetel' then 1 else 2 end, households desc nulls last
          limit 1`
      : [];

  // 2) 건축물대장 표제부
  let titles: TitleRow[] = [];
  let titlesLoaded = false;
  let recapHouseholds: number | null = null;
  if (pnu && env.dataGoKrKey) {
    try {
      const t = await getTitles(pnu);
      titles = t.titles;
      recapHouseholds = t.recap?.households ?? null;
      titlesLoaded = true;
    } catch (e) {
      notes.push(`건축물대장 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!env.dataGoKrKey) {
    notes.push("DATA_GO_KR_KEY 가 없어 건축물대장(용도·동·호·면적)을 자동으로 불러오지 못했습니다.");
  }
  const main = mainTitle(titles);
  const housingTitles = titles.filter((t) => HOUSING.test(`${t.main_purpose ?? ""} ${t.etc_purpose ?? ""}`));
  const building: InspectResult["building"] = main
    ? {
        name: main.bld_nm,
        purpose: main.etc_purpose || main.main_purpose,
        approvedYear: titles.reduce<number | null>((y, t) => {
          const v = t.approved_at ? Number(t.approved_at.slice(0, 4)) : null;
          return v && (!y || v < y) ? v : y;
        }, null),
        households: recapHouseholds ?? (titles.reduce((n, t) => n + (t.households ?? 0), 0) || null),
        dongCount: housingTitles.length || titles.length,
        maxFloor: titles.reduce<number | null>((m, t) => (t.floors_above && (!m || t.floors_above > m) ? t.floors_above : m), null),
        totalArea: titles.reduce((n, t) => n + (t.total_area ?? 0), 0) || null,
        platArea: main.plat_area,
      }
    : null;

  // 3) 유형 판별
  let suggestedType: PropertyType | null = null;
  let typeReason: string | null = null;
  if (complex && isPropertyType(complex.property_type)) {
    suggestedType = complex.property_type;
    typeReason = "수집된 실거래 단지";
  } else if (main) {
    suggestedType = typeFromPurpose(main.main_purpose, main.etc_purpose);
    if (suggestedType) typeReason = `건축물대장 용도(${main.etc_purpose || main.main_purpose})`;
  }

  // 4) 토지: 건물이 없거나(나대지·임야) 판별이 안 됐을 때 토지특성으로
  let land: InspectResult["land"] = null;
  if (pnu && (!suggestedType || suggestedType === "house") && !(titles.length === 0 && jusoApt)) {
    try {
      land = await landCharacteristics(pnu);
    } catch (e) {
      notes.push(`토지특성 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!land && !env.vworldKey && !suggestedType) notes.push("VWORLD_KEY 가 없어 토지 지목·면적을 자동으로 불러오지 못했습니다.");
  }
  if (!suggestedType) {
    if (jusoApt) {
      suggestedType = "apt";
      typeReason = "도로명주소(공동주택)";
    } else if (titles.length === 0 && (land || mountain || (!hasBuildingName && titlesLoaded))) {
      suggestedType = typeFromJimok(land?.jimok, mountain);
      typeReason = land?.jimok ? `지목(${land.jimok})` : mountain ? "산 지번" : "등록된 건물 없음";
    }
  }

  // 5) 평형·동·호: 건축물대장 호별 면적 + 실거래 면적
  let units: UnitInfo[] | null = null;
  let unitsPartial = false;
  const wantUnits = suggestedType ? PROPERTY_TYPES[suggestedType].hasComplex || suggestedType === "commercial" : jusoApt;
  if (pnu && env.dataGoKrKey && wantUnits && titles.length) {
    try {
      const r = await getUnits(pnu);
      units = r.units;
      unitsPartial = r.partial;
      // 주거형이면 상가 호실은 뺀다
      if (suggestedType && PROPERTY_TYPES[suggestedType].hasComplex) {
        const housing = units.filter((u) => !u.purpose || HOUSING.test(u.purpose));
        if (housing.length) units = housing;
      }
    } catch (e) {
      notes.push(`호별 면적 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const trades = complex
    ? await sql<{ area: number; n: number; median: number | null }[]>`
        select round(area_m2::numeric, 2)::float8 as area, count(*)::int as n,
          (percentile_cont(0.5) within group (order by price) filter (
            where deal_kind = 'sale' and not is_canceled and deal_date >= current_date - 365))::float8 as median
        from transactions where complex_id = ${complex.id} and area_m2 is not null
        group by 1 order by 1`
    : [];

  const samples = new Map<number, { area: number; count: number; units: number; trades: number; supply: number | null; medianPrice: number | null }>();
  for (const u of units ?? []) {
    const k = Math.round(u.area * 100) / 100;
    const cur = samples.get(k) ?? { area: k, count: 0, units: 0, trades: 0, supply: null, medianPrice: null };
    cur.count += 1;
    cur.units += 1;
    cur.supply ??= u.supply;
    samples.set(k, cur);
  }
  for (const t of trades) {
    const cur = samples.get(t.area) ?? { area: t.area, count: 0, units: 0, trades: 0, supply: null, medianPrice: null };
    cur.count += t.n;
    cur.trades += t.n;
    cur.medianPrice = t.median;
    samples.set(t.area, cur);
  }
  // 대장에 호가 있는데 실거래만 있는 드문 면적(오기·분양권 등)은 버린다
  const areaTypes = clusterAreas([...samples.values()]).filter((a) => !units?.length || a.units);

  const dongs = units?.length
    ? sortDongs([...new Set(units.map((u) => u.dong).filter(Boolean))])
    : housingTitles.length > 1
      ? sortDongs(housingTitles.map((t) => t.dong_nm).filter((d): d is string => Boolean(d)))
      : parseDongList(sp.get("dongs"));

  const body: InspectResult = {
    pnu,
    suggestedType,
    typeReason,
    complex: complex ?? null,
    building,
    land,
    areaTypes,
    dongs,
    units: units?.length ? toTuples(units) : null,
    unitsPartial,
    notes,
  };
  return NextResponse.json(body);
}
