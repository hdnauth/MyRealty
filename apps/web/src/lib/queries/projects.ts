import "server-only";
import { sql } from "../db";
import { ZONE_PHASES, type ZonePhase } from "../projects";

/*
 * 개발·테마 화면: 정비사업(목록·필터·단계 분포·최근 변화·팔로우·상세), 재건축 후보, 교통 호재, 규제, 공급.
 * 정비구역 지역은 출처가 준 시도·시군구 이름(attrs.sido·gu)으로 거른다 — 서울 밖은 시군구 코드가 출처마다 달라서.
 */

export type ZoneFilter = {
  sido: string | null;
  gu: string | null;
  kind: string | null;
  /** null = 진행 중 전체(완료 제외), "all" = 완료 포함 */
  phase: ZonePhase | "all" | null;
  q: string | null;
  /** 이 관심 부동산 반경 NEAR_M 안만 */
  near: string | null;
  /** 팔로우한 구역만 */
  followed: boolean;
  sort: "recent" | "stage" | "near" | "households";
};

export const NEAR_M = 1000;

export type ZoneRow = {
  id: number;
  name: string;
  kind: string;
  stage: string | null;
  stage_order: number | null;
  stage_date: string | null;
  sgg_cd: string | null;
  sido: string | null;
  gu: string | null;
  address: string | null;
  households_plan: number | null;
  lng: number | null;
  lat: number | null;
  url: string | null;
  map_code: string | null;
  geo: string | null;
  source: string;
  followed: boolean;
  changed_at: string | null;
  near_label: string | null;
  near_item: string | null;
  near_m: number | null;
};

const ZONE_COLS = sql`
  z.id::int as id, z.name, z.kind, z.stage, z.stage_order, z.stage_date::text, z.sgg_cd, z.attrs->>'sido' as sido,
  z.attrs->>'gu' as gu, z.address, z.households_plan,
  ST_X(ST_PointOnSurface(z.geom)) as lng, ST_Y(ST_PointOnSurface(z.geom)) as lat,
  coalesce(z.attrs->>'cafe_url', z.attrs->>'url') as url, z.attrs->>'map_code' as map_code, z.attrs->>'geo' as geo,
  split_part(z.source_key, ':', 1) as source`;

function where(uid: string, f: ZoneFilter, opts: { phase: boolean }) {
  const phase = f.phase && f.phase !== "all" ? ZONE_PHASES.find((p) => p.key === f.phase) : null;
  return sql`
    ${f.sido ? sql`and z.attrs->>'sido' = ${f.sido}` : sql``}
    ${f.gu ? sql`and z.attrs->>'gu' = ${f.gu}` : sql``}
    ${f.kind ? sql`and z.kind = ${f.kind}` : sql``}
    ${f.q ? sql`and (z.name ilike ${"%" + f.q + "%"} or z.address ilike ${"%" + f.q + "%"} or z.attrs->>'full_name' ilike ${"%" + f.q + "%"})` : sql``}
    ${opts.phase && phase ? sql`and z.stage_order between ${phase.from} and ${phase.to}` : sql``}
    ${opts.phase && !f.phase ? sql`and z.stage_order is distinct from 9` : sql``}
    ${f.followed ? sql`and exists (select 1 from zone_follows zf where zf.zone_id = z.id and zf.user_id = ${uid})` : sql``}
    ${f.near
      ? sql`and exists (select 1 from watch_items w where w.id = ${f.near} and w.user_id = ${uid} and w.geom is not null and z.geom is not null
              and ST_DWithin(z.geom::geography, w.geom::geography, ${NEAR_M}))`
      : sql``}`;
}

export async function listZones(uid: string, f: ZoneFilter, limit: number): Promise<{ rows: ZoneRow[]; total: number }> {
  const order =
    f.sort === "stage" ? sql`z.stage_order desc nulls last, z.name`
    : f.sort === "near" ? sql`near.dist nulls last, z.name`
    : f.sort === "households" ? sql`z.households_plan desc nulls last, z.name`
    : sql`coalesce(h.changed_at, z.updated_at) desc, z.stage_order desc nulls last, z.name`;
  const [rows, [{ n }]] = await Promise.all([
    sql<ZoneRow[]>`
      select ${ZONE_COLS}, h.changed_at::text as changed_at,
        exists (select 1 from zone_follows zf where zf.zone_id = z.id and zf.user_id = ${uid}) as followed,
        near.label as near_label, near.id::text as near_item, near.dist as near_m
      from redevelopment_zones z
      left join lateral (select max(changed_at) as changed_at from zone_stage_history where zone_id = z.id) h on true
      left join lateral (
        select w.id, w.label, ST_Distance(z.geom::geography, w.geom::geography)::int as dist from watch_items w
        where w.user_id = ${uid} and w.geom is not null and z.geom is not null and ST_DWithin(z.geom::geography, w.geom::geography, 3000)
        order by dist limit 1) near on true
      where true ${where(uid, f, { phase: true })}
      order by ${order}
      limit ${limit}`,
    sql<{ n: number }[]>`select count(*)::int as n from redevelopment_zones z where true ${where(uid, f, { phase: true })}`,
  ]);
  return { rows, total: n };
}

/** 단계별 개수(단계 필터는 빼고 — 분포 막대가 필터와 상관없이 전체 흐름을 보이게) */
export async function zoneStageCounts(uid: string, f: ZoneFilter) {
  return sql<{ stage_order: number | null; n: number }[]>`
    select z.stage_order, count(*)::int as n from redevelopment_zones z
    where true ${where(uid, f, { phase: false })}
    group by 1 order by 1`;
}

/** 필터 칩: 시도·(시도를 고르면) 시군구·유형별 개수(진행 중 기준) */
export async function zoneFacets(sido: string | null) {
  const [sidos, gus, kinds] = await Promise.all([
    sql<{ name: string; n: number }[]>`
      select attrs->>'sido' as name, count(*)::int as n from redevelopment_zones
      where attrs->>'sido' is not null and stage_order is distinct from 9 group by 1 order by n desc`,
    sido
      ? sql<{ name: string; n: number }[]>`
          select attrs->>'gu' as name, count(*)::int as n from redevelopment_zones
          where attrs->>'sido' = ${sido} and attrs->>'gu' is not null and stage_order is distinct from 9 group by 1 order by n desc`
      : [],
    sql<{ kind: string; n: number }[]>`
      select kind, count(*)::int as n from redevelopment_zones
      where stage_order is distinct from 9 ${sido ? sql`and attrs->>'sido' = ${sido}` : sql``} group by 1 order by n desc`,
  ]);
  return { sidos, gus, kinds };
}

export type StageChange = {
  id: number;
  zone_id: number;
  name: string;
  kind: string;
  gu: string | null;
  stage: string | null;
  prev_stage: string | null;
  stage_order: number | null;
  changed_at: string;
};

export async function recentStageChanges(f: Pick<ZoneFilter, "sido" | "gu" | "kind">, limit = 8) {
  return sql<StageChange[]>`
    select h.id::int as id, z.id::int as zone_id, z.name, z.kind, z.attrs->>'gu' as gu, h.stage, h.prev_stage, h.stage_order,
      h.changed_at::text as changed_at
    from zone_stage_history h join redevelopment_zones z on z.id = h.zone_id
    where true ${f.sido ? sql`and z.attrs->>'sido' = ${f.sido}` : sql``} ${f.gu ? sql`and z.attrs->>'gu' = ${f.gu}` : sql``}
      ${f.kind ? sql`and z.kind = ${f.kind}` : sql``}
    order by h.changed_at desc limit ${limit}`;
}

export type ItemProjects = {
  id: string;
  label: string;
  zones: number;
  advanced: number;
  nearest: { name: string; stage: string | null; dist: number } | null;
  infra: { name: string; status: string; expected_open: string | null; dist: number } | null;
};

/** 내 관심 부동산마다 반경 1km 정비구역(진행 중) 수와 가장 가까운 구역, 3km 안 계획 철도·도로 */
export async function myItemProjects(uid: string): Promise<ItemProjects[]> {
  return sql<ItemProjects[]>`
    select w.id::text as id, w.label, coalesce(zc.zones, 0) as zones, coalesce(zc.advanced, 0) as advanced, zn.nearest, inf.infra
    from watch_items w
    left join lateral (
      select count(*)::int as zones, count(*) filter (where z.stage_order between 5 and 8)::int as advanced
      from redevelopment_zones z
      where z.geom is not null and z.stage_order is distinct from 9 and ST_DWithin(z.geom::geography, w.geom::geography, ${NEAR_M})) zc on true
    left join lateral (
      select json_build_object('name', z.name, 'stage', z.stage, 'dist', ST_Distance(z.geom::geography, w.geom::geography)::int) as nearest
      from redevelopment_zones z
      where z.geom is not null and z.stage_order is distinct from 9 and ST_DWithin(z.geom::geography, w.geom::geography, ${NEAR_M})
      order by z.geom <-> w.geom limit 1) zn on true
    left join lateral (
      select json_build_object('name', p.name, 'status', p.status, 'expected_open', p.expected_open,
        'dist', ST_Distance(p.geom::geography, w.geom::geography)::int) as infra
      from infra_projects p
      where p.geom is not null and p.kind <> 'rail' and p.status <> '개통' and ST_DWithin(p.geom::geography, w.geom::geography, 3000)
      order by p.geom <-> w.geom limit 1) inf on true
    where w.user_id = ${uid} and w.geom is not null
    order by w.sort_order, w.created_at`;
}

export type ZoneEffect = { stage: string | null; changed_on: string; complex_change: number | null; region_change: number | null; excess: number | null; n_before: number; n_after: number };

export type ZoneDetail = ZoneRow & {
  households_now: number | null;
  area_m2: number | null;
  full_name: string | null;
  source_key: string;
  molit: { stage: string | null; kind: string | null; executor: string | null; households: number | null } | null;
  extra: Record<string, unknown>;
  history: { stage: string | null; prev_stage: string | null; changed_at: string }[];
  complexes: { id: number; name: string; build_year: number | null; households: number | null; dist: number; ppy: number | null; n: number; how: string | null }[];
  effects: ZoneEffect[];
  followers: number;
};

/** 구역 상세: 단계 이력, 연결 단지(없으면 주변 300m)의 최근 1년 평당가, 단계 효과, 팔로우 */
export async function zoneDetail(uid: string, id: number): Promise<ZoneDetail | null> {
  const [z] = await sql<Omit<ZoneDetail, "history" | "complexes" | "effects">[]>`
    select ${ZONE_COLS}, z.households_now, z.area_m2::float8 as area_m2, z.attrs->>'full_name' as full_name, z.source_key,
      z.attrs->'molit' as molit, z.attrs as extra, null::text as changed_at,
      exists (select 1 from zone_follows zf where zf.zone_id = z.id and zf.user_id = ${uid}) as followed,
      (select count(*)::int from zone_follows zf where zf.zone_id = z.id) as followers,
      near.label as near_label, near.id::text as near_item, near.dist as near_m
    from redevelopment_zones z
    left join lateral (
      select w.id, w.label, ST_Distance(z.geom::geography, w.geom::geography)::int as dist from watch_items w
      where w.user_id = ${uid} and w.geom is not null and z.geom is not null and ST_DWithin(z.geom::geography, w.geom::geography, 3000)
      order by dist limit 1) near on true
    where z.id = ${id}`;
  if (!z) return null;
  const ppy = sql`
    left join lateral (
      select percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785))::float8 as ppy, count(*)::int as n
      from transactions t where t.complex_id = c.id and t.deal_kind = 'sale' and not t.is_canceled and t.area_m2 > 0
        and t.deal_date >= current_date - 365) s on true`;
  const [history, linked, effects] = await Promise.all([
    sql<ZoneDetail["history"]>`
      select stage, prev_stage, changed_at::text from zone_stage_history where zone_id = ${id} order by changed_at desc limit 20`,
    sql<ZoneDetail["complexes"]>`
      select c.id::int as id, c.name, c.build_year, c.households, coalesce(zc.dist_m, 0) as dist, s.ppy, coalesce(s.n, 0) as n, zc.how
      from zone_complexes zc join complexes c on c.id = zc.complex_id ${ppy}
      where zc.zone_id = ${id} order by c.households desc nulls last limit 8`,
    sql<ZoneEffect[]>`
      select stage, changed_on::text, complex_change, region_change, excess, n_before, n_after
      from zone_stage_effects where zone_id = ${id} order by changed_on desc`,
  ]);
  const complexes = linked.length || z.lng === null
    ? linked
    : await sql<ZoneDetail["complexes"]>`
        select c.id::int as id, c.name, c.build_year, c.households,
          ST_Distance(c.geom::geography, ST_SetSRID(ST_MakePoint(${z.lng}, ${z.lat}), 4326)::geography)::int as dist,
          s.ppy, coalesce(s.n, 0) as n, null::text as how
        from complexes c ${ppy}
        where c.geom is not null and ST_DWithin(c.geom::geography, ST_SetSRID(ST_MakePoint(${z.lng}, ${z.lat}), 4326)::geography, 300)
        order by dist limit 6`;
  return { ...z, history, complexes, effects };
}

/** 단지 상세용: 이 단지가 연결된 정비구역 */
export async function complexZones(complexId: number) {
  return sql<{ id: number; name: string; kind: string; stage: string | null; stage_order: number | null; how: string }[]>`
    select z.id::int as id, z.name, z.kind, z.stage, z.stage_order, zc.how
    from zone_complexes zc join redevelopment_zones z on z.id = zc.zone_id
    where zc.complex_id = ${complexId} order by z.stage_order desc nulls last`;
}

/** 단계 묶음별 가격 프리미엄: 같은 시군구 아파트 전체 중위 대비 정비구역 연결 단지 중위(최근 1년 전용 평당가) */
export async function stagePremium(sido: string | null) {
  return sql<{ phase: ZonePhase; ppy: number | null; base: number | null; complexes: number; n: number }[]>`
    with zc as (
      select distinct on (zc.complex_id) zc.complex_id, z.stage_order, c.sgg_cd
      from zone_complexes zc join redevelopment_zones z on z.id = zc.zone_id join complexes c on c.id = zc.complex_id
      where z.stage_order is not null ${sido ? sql`and z.attrs->>'sido' = ${sido}` : sql``}
      order by zc.complex_id, z.stage_order desc),
    t as (
      select zc.complex_id, zc.stage_order, zc.sgg_cd, t.price / (t.area_m2 / 3.305785) as ppy
      from zc join transactions t on t.complex_id = zc.complex_id
      where t.deal_kind = 'sale' and not t.is_canceled and t.area_m2 > 0 and t.deal_date >= current_date - 365),
    base as (
      select c.sgg_cd, percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785))::float8 as ppy
      from transactions t join complexes c on c.id = t.complex_id
      where c.property_type = 'apt' and c.sgg_cd in (select distinct sgg_cd from zc)
        and t.deal_kind = 'sale' and not t.is_canceled and t.area_m2 > 0 and t.deal_date >= current_date - 365
      group by c.sgg_cd)
    select case when stage_order <= 3 then 'early' when stage_order = 4 then 'union' when stage_order <= 6 then 'approved'
                when stage_order <= 8 then 'building' else 'done' end as phase,
      percentile_cont(0.5) within group (order by t.ppy)::float8 as ppy,
      percentile_cont(0.5) within group (order by b.ppy)::float8 as base,
      count(distinct t.complex_id)::int as complexes, count(*)::int as n
    from t join base b on b.sgg_cd = t.sgg_cd
    group by 1 order by min(stage_order)`;
}

/** 팔로우 토글 */
export async function setZoneFollow(uid: string, zoneId: number, on: boolean) {
  if (on) await sql`insert into zone_follows (user_id, zone_id) values (${uid}, ${zoneId}) on conflict do nothing`;
  else await sql`delete from zone_follows where user_id = ${uid} and zone_id = ${zoneId}`;
}

// ───── 재건축 후보 ─────

/** 서울시 도시계획 조례 기준 용적률 상한(참고) — special.ts FAR_CAP 과 같음 */
export const FAR_CAP: Record<string, number> = {
  제1종전용주거지역: 100, 제2종전용주거지역: 120, 제1종일반주거지역: 150, 제2종일반주거지역: 200, 제3종일반주거지역: 250, 준주거지역: 400,
};

export type RebuildCandidate = {
  id: number;
  name: string;
  sgg_cd: string;
  sgg_name: string | null;
  build_year: number;
  households: number | null;
  vl_rat: number | null;
  plat_area: number | null;
  zones: string[] | null;
  ppy: number | null;
  n: number;
  zone: { id: number; name: string; stage: string | null } | null;
  mine: string | null;
};

export async function rebuildCandidates(uid: string, opts: { sgg: string | null; minAge: number }) {
  const year = new Date().getFullYear();
  const [rows, sggs] = await Promise.all([
    sql<RebuildCandidate[]>`
      select c.id::int as id, c.name, c.sgg_cd, t.name as sgg_name, c.build_year, c.households,
        -- 대장의 0 은 '값 없음'
        coalesce(nullif((b.recap->>'vl_rat')::float8, 0), (select nullif(max((x->>'vl_rat')::float8), 0) from jsonb_array_elements(b.titles) x)) as vl_rat,
        coalesce(nullif((b.recap->>'plat_area')::float8, 0), (select nullif(max((x->>'plat_area')::float8), 0) from jsonb_array_elements(b.titles) x)) as plat_area,
        p.land_use_zone as zones, s.ppy, coalesce(s.n, 0) as n, zn.zone,
        (select w.id::text from watch_items w where w.user_id = ${uid} and w.complex_id = c.id limit 1) as mine
      from complexes c
      left join collect_targets t on t.sgg_cd = c.sgg_cd
      left join building_registers b on b.pnu = c.pnu
      left join parcels p on p.pnu = c.pnu
      left join lateral (
        select percentile_cont(0.5) within group (order by tr.price / (tr.area_m2 / 3.305785))::float8 as ppy, count(*)::int as n
        from transactions tr where tr.complex_id = c.id and tr.deal_kind = 'sale' and not tr.is_canceled and tr.area_m2 > 0
          and tr.deal_date >= current_date - 365) s on true
      left join lateral (
        select json_build_object('id', z.id, 'name', z.name, 'stage', z.stage) as zone
        from zone_complexes zc join redevelopment_zones z on z.id = zc.zone_id
        where zc.complex_id = c.id order by z.stage_order desc nulls last limit 1) zn on true
      where c.property_type = 'apt' and c.build_year is not null and c.build_year <= ${year - opts.minAge}
        and coalesce(c.households, 0) >= 100
        ${opts.sgg ? sql`and c.sgg_cd = ${opts.sgg}` : sql``}
      limit 800`,
    sql<{ sgg_cd: string; name: string | null; n: number }[]>`
      select c.sgg_cd, max(t.name) as name, count(*)::int as n from complexes c left join collect_targets t on t.sgg_cd = c.sgg_cd
      where c.property_type = 'apt' and c.build_year <= ${year - opts.minAge} and coalesce(c.households, 0) >= 100
      group by c.sgg_cd order by n desc`,
  ]);
  return { rows, sggs };
}

// ───── 교통 호재 ─────

export type TransitStation = {
  id: number;
  name: string;
  line_name: string | null;
  status: string;
  expected_open: string | null;
  months_left: number | null;
  precision: string | null;
  lng: number | null;
  lat: number | null;
  complexes: number;
  ppy: number | null;
  near_label: string | null;
  near_m: number | null;
  /** 개통 역: 반경 1km 단지 평당가 변화(개통 전후 12개월)와 시군구 지수 변화 */
  effect: { complex: number | null; region: number | null; n: number } | null;
};

export async function transitStations(uid: string): Promise<TransitStation[]> {
  const rows = await sql<(Omit<TransitStation, "effect"> & { sgg_cd: string | null })[]>`
    select p.id::int as id, p.name, p.line_name, p.status, p.expected_open::text,
      case when p.expected_open > current_date
        then (extract(year from age(p.expected_open, current_date)) * 12 + extract(month from age(p.expected_open, current_date)))::int end as months_left,
      p.attrs->>'precision' as precision, ST_X(p.geom) as lng, ST_Y(p.geom) as lat,
      coalesce(cx.n, 0) as complexes, cx.ppy, cx.sgg_cd, near.label as near_label, near.dist as near_m
    from infra_projects p
    left join lateral (
      select count(distinct c.id)::int as n, mode() within group (order by c.sgg_cd) as sgg_cd,
        percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785))::float8 as ppy
      from complexes c left join transactions t on t.complex_id = c.id and t.deal_kind = 'sale' and not t.is_canceled
        and t.area_m2 > 0 and t.deal_date >= current_date - 365
      where c.property_type = 'apt' and c.geom is not null and ST_DWithin(c.geom::geography, p.geom::geography, 500)) cx on true
    left join lateral (
      select w.label, ST_Distance(p.geom::geography, w.geom::geography)::int as dist from watch_items w
      where w.user_id = ${uid} and w.geom is not null and ST_DWithin(p.geom::geography, w.geom::geography, 5000)
      order by dist limit 1) near on true
    where p.kind = 'station' and p.geom is not null and GeometryType(p.geom) = 'POINT'
    -- 노선은 개통 전·개통 예정 빠른 순, 역은 시드의 노선 순서(직접 등록은 이름순)
    order by (p.status = '개통'), min(p.expected_open) over (partition by p.line_name) nulls last, p.line_name,
      p.expected_open nulls last, (p.attrs->>'seq')::int nulls last, p.name
    limit 400`;
  // 개통한 역: 반경 1km 단지 평당가 전후 12개월(수집된 지역만 값이 나온다)
  const effects = await Promise.all(
    rows.map(async (r) => {
      if (r.status !== "개통" || !r.expected_open || r.lng === null) return null;
      const [[c], [g]] = await Promise.all([
        sql<{ before: number | null; after: number | null; n: number }[]>`
          select
            percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785)) filter (where t.deal_date >= ${r.expected_open}::date - 365 and t.deal_date < ${r.expected_open}::date)::float8 as before,
            percentile_cont(0.5) within group (order by t.price / (t.area_m2 / 3.305785)) filter (where t.deal_date >= ${r.expected_open}::date and t.deal_date < ${r.expected_open}::date + 365)::float8 as after,
            count(*)::int as n
          from complexes c join transactions t on t.complex_id = c.id
          where c.property_type = 'apt' and c.geom is not null
            and ST_DWithin(c.geom::geography, ST_SetSRID(ST_MakePoint(${r.lng}, ${r.lat}), 4326)::geography, 1000)
            and t.deal_kind = 'sale' and not t.is_canceled and t.area_m2 > 0
            and t.deal_date between ${r.expected_open}::date - 365 and ${r.expected_open}::date + 365`,
        r.sgg_cd
          ? sql<{ before: number | null; after: number | null }[]>`
              select avg(value) filter (where period >= ${r.expected_open}::date - 365 and period < ${r.expected_open}::date)::float8 as before,
                     avg(value) filter (where period >= ${r.expected_open}::date and period < ${r.expected_open}::date + 365)::float8 as after
              from series_values where code = ${`idx.${r.sgg_cd}`}`
          : Promise.resolve([{ before: null, after: null }]),
      ]);
      const ch = (x: { before: number | null; after: number | null } | undefined) => (x?.before && x.after ? x.after / x.before - 1 : null);
      return c && c.n >= 6 ? { complex: ch(c), region: ch(g), n: c.n } : null;
    }),
  );
  return rows.map((r, i) => ({ ...r, sgg_cd: undefined, effect: effects[i] }));
}

// ───── 규제 ─────

export type ItemRegulation = {
  id: string;
  label: string;
  permit: boolean;
  district_plan: boolean;
  zone: boolean;
  uses: string[];
};

/** 내 관심 부동산의 규제·계획 구역: 토지이용계획(필지) + 경계 자료(점이 들어가는지) */
export async function myRegulations(uid: string) {
  const [items, summary] = await Promise.all([
    sql<ItemRegulation[]>`
      select w.id::text as id, w.label,
        coalesce(exists (select 1 from regulation_areas r where r.kind = 'permit' and ST_Contains(r.geom, w.geom)), false)
          or coalesce(p.land_uses::text like '%토지거래%', false) as permit,
        coalesce(exists (select 1 from regulation_areas r where r.kind = 'district_plan' and ST_Contains(r.geom, w.geom)), false)
          or coalesce(p.land_uses::text like '%지구단위계획%', false) as district_plan,
        -- '정비구역기타' 같은 묶음 항목은 빼고 정확한 이름만
        exists (select 1 from jsonb_array_elements(coalesce(p.land_uses, '[]'::jsonb)) u where u->>'name' ~ '^(정비구역|재정비촉진(지구|구역))$')
          or exists (select 1 from redevelopment_zones z where GeometryType(z.geom) like '%POLYGON' and ST_Contains(z.geom, w.geom)) as zone,
        coalesce((select array_agg(u->>'name') from jsonb_array_elements(p.land_uses) u
                  where u->>'name' ~ '허가|지구단위|정비|촉진|제한|고도|경관|개발'), '{}') as uses
      from watch_items w left join parcels p on p.pnu = w.pnu
      where w.user_id = ${uid} and (w.geom is not null or p.pnu is not null)
      order by w.sort_order, w.created_at`,
    sql<{ kind: string; sido: string | null; sgg_name: string | null; n: number; area_km2: number; dyear: string | null }[]>`
      -- 같은 곳에 여러 번 지정(예: 2025.3 강남3구 · 2025.10 서울 전역)된 구역이 겹치므로 합집합 면적
      select kind, sido, sgg_name, count(*)::int as n, round((ST_Area(ST_Union(geom)::geography) / 1e6)::numeric, 2)::float8 as area_km2,
        max(dyear) as dyear
      from regulation_areas group by kind, sido, sgg_name order by kind, area_km2 desc limit 200`,
  ]);
  return { items, summary };
}

/** 관심 부동산 한 곳의 규제 구역(부동산 상세 개요용) */
export async function itemRegulation(itemId: string) {
  const [r] = await sql<{ permit: boolean; district_plan: boolean; names: string[] }[]>`
    select
      coalesce(exists (select 1 from regulation_areas r where r.kind = 'permit' and ST_Contains(r.geom, w.geom)), false)
        or coalesce(p.land_uses::text like '%토지거래%', false) as permit,
      coalesce(exists (select 1 from regulation_areas r where r.kind = 'district_plan' and ST_Contains(r.geom, w.geom)), false)
        or coalesce(p.land_uses::text like '%지구단위계획%', false) as district_plan,
      coalesce((select array_agg(distinct r.name) from regulation_areas r where ST_Contains(r.geom, w.geom)), '{}') as names
    from watch_items w left join parcels p on p.pnu = w.pnu where w.id = ${itemId}`;
  return r && (r.permit || r.district_plan) ? r : null;
}

// ───── 공급 ─────

export type SupplyRow = {
  sgg_cd: string;
  name: string;
  near_term: number;
  near_term_zones: number;
  mid_term: number;
  mid_term_zones: number;
  unknown_hh: number;
  move_in: number;
  move_in_n: number;
  mine: boolean;
};

/**
 * 시군구별 공급 파이프라인: 관리처분~착공(2~4년 안 입주 물량), 조합설립~사업시행인가(4~8년), 입주 예정(36개월, 청약홈).
 * 정비사업 세대수는 국토부 전국 통합·시군구 자료의 '공급 예정 세대수'(없으면 세대수 미상으로 센다).
 */
export async function supplyPipeline(uid: string) {
  return sql<SupplyRow[]>`
    with z as (
      select sgg_cd, max(attrs->>'gu') as gu, max(attrs->>'sido') as sido,
        coalesce(sum(households_plan) filter (where stage_order between 6 and 8), 0)::int as near_term,
        count(*) filter (where stage_order between 6 and 8)::int as near_term_zones,
        coalesce(sum(households_plan) filter (where stage_order between 4 and 5), 0)::int as mid_term,
        count(*) filter (where stage_order between 4 and 5)::int as mid_term_zones,
        count(*) filter (where stage_order between 4 and 8 and households_plan is null)::int as unknown_hh
      from redevelopment_zones where sgg_cd is not null group by sgg_cd),
    m as (
      select sgg_cd, coalesce(sum(nullif(regexp_replace(coalesce(payload->>'households', ''), '[^0-9]', '', 'g'), '')::int), 0)::int as move_in,
        count(*)::int as move_in_n
      from events where kind = 'move_in' and sgg_cd is not null and starts_on between current_date and current_date + interval '36 months'
      group by sgg_cd)
    select coalesce(z.sgg_cd, m.sgg_cd) as sgg_cd, coalesce(t.name, concat_ws(' ', z.sido, z.gu), coalesce(z.sgg_cd, m.sgg_cd)) as name,
      coalesce(z.near_term, 0) as near_term, coalesce(z.near_term_zones, 0) as near_term_zones,
      coalesce(z.mid_term, 0) as mid_term, coalesce(z.mid_term_zones, 0) as mid_term_zones, coalesce(z.unknown_hh, 0) as unknown_hh,
      coalesce(m.move_in, 0) as move_in, coalesce(m.move_in_n, 0) as move_in_n,
      exists (select 1 from watch_items w where w.user_id = ${uid} and w.sgg_cd = coalesce(z.sgg_cd, m.sgg_cd)) as mine
    from z full join m on m.sgg_cd = z.sgg_cd
    left join collect_targets t on t.sgg_cd = coalesce(z.sgg_cd, m.sgg_cd)
    where coalesce(z.near_term, 0) + coalesce(z.mid_term, 0) + coalesce(m.move_in, 0) > 0
    order by mine desc, coalesce(z.near_term, 0) + coalesce(m.move_in, 0) desc
    limit 300`;
}
