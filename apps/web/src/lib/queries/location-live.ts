import "server-only";
import { sql } from "../db";
import { ensureOsmPois } from "../external/osm";
import { type LocSummary, scorePoint, type ScorePoi } from "../location-score";
import type { Development, LocCategory } from "./location";

/**
 * 지도 화면 안 단지의 입지 점수를 즉석으로 채운다(매일 수집 ETL 이 아직 계산하지 않은 단지).
 *
 * - full : 시설이 갖춰진 단지(격자 수집 poi_cells 또는 관심 부동산 500m 안) — ETL 과 같은 공식·같은 시설로 계산해 저장한다.
 * - quick: 그 밖의 단지 — OpenStreetMap 에서 주변 역·학교·공원·병원·마트만 보충해 그 항목과 직주근접으로 계산한 간이 점수.
 *          학원·음식점·의원·버스 등 밀집 시설은 빠진다. 다음 매일 수집이 그 칸을 모으면 full 로 바뀐다.
 *
 * 쿼리·조건은 ETL services/etl/src/myrealty_etl/analytics/location.py(POI_SQL·COVERED_SQL·development_summary)와 같다.
 */
const CELL = 0.01;
const COVER_M = 500;
const DENSE = ["food", "cafe", "convenience", "academy", "clinic", "bus"];
const DENSE_R = 1000;
const FAR_R = 5000;
/** 간이 점수에 쓰는 OSM 카테고리(웹 보충이 받는 것) */
const QUICK_CATS = ["subway", "school", "park", "hospital", "mart"];
/** 간이 점수용 OSM 보충 범위(단지 ±2km) — 격자 12칸 안쪽 */
const QUICK_PAD_M = 2000;
/** 이보다 오래된 즉석 점수는 다시 계산(ETL 은 아파트만 매일 갱신) */
const STALE_DAYS = 45;
/** 한 요청의 시간 예산(함수 제한 30초 안). 간이 점수의 OSM 보충은 남은 예산에서 최대 10초 */
const BUDGET_MS = 20_000;
const OSM_MAX_MS = 10_000;
/** OSM 보충이 실패하면 이 인스턴스는 잠시 간이 계산을 쉰다(Overpass 장애 때 요청마다 기다리지 않게) */
const OSM_BACKOFF_MS = 60_000;
let osmDownUntil = 0;

export type { LocSummary };

type Target = {
  id: number;
  lng: number;
  lat: number;
  build_year: number | null;
  covered: boolean;
  total: number | null;
  scores: Record<string, LocCategory> | null;
  basis: "full" | "quick" | null;
  stale: boolean;
};

export function summarize(total: number | null, scores: Record<string, LocCategory> | null, basis: string | null): LocSummary {
  return {
    total,
    basis: basis === "quick" ? "quick" : "full",
    cats: Object.fromEntries(Object.entries(scores ?? {}).map(([k, v]) => [k, v.score])),
  };
}

async function poisNear(lng: number, lat: number): Promise<ScorePoi[]> {
  return sql<ScorePoi[]>`
    with pt as (select ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326) as p,
                       ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography as g,
                       1.0 / (111320 * cos(radians(${lat}))) as kx, 1.0 / 110574 as ky)
    select source, source_id, category, subcategory, name, area_m2::float8 as area_m2, attrs->>'line' as line,
           ST_Distance(coalesce(shape, geom)::geography, pt.g)::float8 as d,
           (case when shape is not null and category = 'park'
                then ST_Area(ST_Intersection(shape::geography, ST_Buffer(pt.g, 1000)))
                else area_m2::float8 end)::float8 as area_1km
    from pois, pt
    where category = any(${DENSE})
      and geom && ST_Expand(pt.p, ${DENSE_R} * pt.kx, ${DENSE_R} * pt.ky)
      and ST_DWithin(geom::geography, pt.g, ${DENSE_R})
    union all
    select source, source_id, category, subcategory, name, area_m2::float8 as area_m2, attrs->>'line' as line,
           ST_Distance(coalesce(shape, geom)::geography, pt.g)::float8 as d,
           (case when shape is not null and category = 'park'
                then ST_Area(ST_Intersection(shape::geography, ST_Buffer(pt.g, 1000)))
                else area_m2::float8 end)::float8 as area_1km
    from pois, pt
    where category <> all(${DENSE})
      and (geom && ST_Expand(pt.p, ${FAR_R} * pt.kx, ${FAR_R} * pt.ky) or shape && ST_Expand(pt.p, ${FAR_R} * pt.kx, ${FAR_R} * pt.ky))
      and ST_DWithin(coalesce(shape, geom)::geography, pt.g, ${FAR_R})`;
}

/** 20km 안에 자료가 있는 카테고리(없으면 '미수집'으로 빼고 나머지 비중으로 다시 나눈다) */
async function availableCategories(lng: number, lat: number): Promise<Set<string>> {
  const rows = await sql<{ category: string }[]>`
    select distinct category from pois
    where ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, 20000)`;
  return new Set(rows.map((r) => r.category));
}

async function developmentSummary(lng: number, lat: number, buildYear: number | null): Promise<Development> {
  const [zones, infra] = await Promise.all([
    sql<Development["zones"]>`
      select id::int, name, kind, stage, stage_order, stage_date::text, households_plan,
        ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)::int as dist_m
      from redevelopment_zones
      where geom is not null and ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, 1500)
      order by dist_m limit 20`,
    sql<Development["infra"]>`
      select id::int, name, kind, line_name, status, status_order, expected_open::text,
        ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)::int as dist_m
      from infra_projects
      where geom is not null and ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, 3000)
      order by dist_m limit 20`,
  ]);
  const planned = infra.filter((r) => r.status !== "개통");
  const out: Development = {
    zones,
    zones_count: zones.length,
    zones_advanced: zones.filter((r) => (r.stage_order ?? 0) >= 5).length,
    infra,
    nearest_planned_station: planned[0] ?? null,
  };
  const today = new Date();
  if (planned[0]?.expected_open) {
    out.months_to_open = Math.max(0, Math.floor((Date.parse(planned[0].expected_open) - today.getTime()) / 86_400_000 / 30));
  }
  if (buildYear) {
    const age = today.getFullYear() - buildYear;
    out.rebuild = { age, eligible: age >= 30, years_left: Math.max(0, 30 - age) };
  }
  return out;
}

async function loadTargets(ids: number[]): Promise<Target[]> {
  return sql<Target[]>`
    select c.id::int, ST_X(c.geom) as lng, ST_Y(c.geom) as lat, c.build_year,
      (pc.cx is not null or exists (
         select 1 from watch_items w where w.geom is not null and ST_DWithin(c.geom::geography, w.geom::geography, ${COVER_M}))) as covered,
      s.total, s.scores, s.basis,
      coalesce(s.computed_at < now() - ${`${STALE_DAYS} days`}::interval, false) as stale
    from complexes c
    left join poi_cells pc on pc.cx = floor(ST_X(c.geom) / ${CELL})::int and pc.cy = floor(ST_Y(c.geom) / ${CELL})::int
    left join location_scores s on s.target_type = 'complex' and s.target_id = c.id::text
    where c.id = any(${ids}) and c.geom is not null`;
}

async function save(id: number, total: number | null, scores: Record<string, LocCategory>, development: Development, basis: "full" | "quick") {
  await sql`
    insert into location_scores (target_type, target_id, total, scores, development, computed_at, basis)
    values ('complex', ${String(id)}, ${total}, ${sql.json(scores)}, ${sql.json(development)}, now(), ${basis})
    on conflict (target_type, target_id) do update set total = excluded.total, scores = excluded.scores,
      development = excluded.development, computed_at = now(), basis = excluded.basis`;
}

/** 다시 계산해야 하는지: 없음 · 오래됨 · 간이였는데 이제 시설이 갖춰짐 */
const needs = (t: Target) => t.basis === null || t.stale || (t.basis === "quick" && t.covered);

/**
 * ids 단지의 점수를 돌려주고, 없는 것은 한도 안에서 계산해 저장한다.
 * 한 번에 full 은 maxFull 곳, quick 은 maxQuick 곳(OSM 보충이 느려서)까지만 — 나머지는 pending 으로 돌려 다음 요청에서.
 */
export async function ensureComplexScores(
  ids: number[],
  { maxFull = 10, maxQuick = 3, signal }: { maxFull?: number; maxQuick?: number; signal?: AbortSignal } = {},
): Promise<{ scores: Record<number, LocSummary>; pending: number[] }> {
  const started = Date.now();
  const targets = await loadTargets(ids);
  const scores: Record<number, LocSummary> = {};
  const pending: number[] = [];
  let full = 0;
  let quick = 0;
  const availCache = new Map<string, Set<string>>();
  // 요청 순서(화면 가운데에 가까운 순)를 지킨다
  const order = new Map(ids.map((id, i) => [id, i]));
  targets.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  for (const t of targets) {
    if (!needs(t)) {
      scores[t.id] = summarize(t.total, t.scores, t.basis);
      continue;
    }
    if (signal?.aborted) {
      pending.push(t.id);
      continue;
    }
    const kind: "full" | "quick" = t.covered ? "full" : "quick";
    const left = BUDGET_MS - (Date.now() - started);
    const quickBlocked = kind === "quick" && (Date.now() < osmDownUntil || left < 3_000);
    if ((kind === "full" && (full >= maxFull || left <= 0)) || (kind === "quick" && (quick >= maxQuick || quickBlocked))) {
      if (t.basis !== null) scores[t.id] = summarize(t.total, t.scores, t.basis);
      pending.push(t.id);
      continue;
    }
    try {
      let avail: Set<string>;
      if (kind === "quick") {
        quick++;
        const dLat = QUICK_PAD_M / 110_574;
        const dLng = QUICK_PAD_M / (111_320 * Math.cos((t.lat * Math.PI) / 180));
        const note = await ensureOsmPois([t.lng - dLng, t.lat - dLat, t.lng + dLng, t.lat + dLat], { timeoutMs: Math.min(OSM_MAX_MS, left - 1_000) });
        // OSM 을 못 받았으면 시설이 비어 점수가 낮게 틀어진다 — 계산하지 않는다(매일 수집이 그 칸을 채운다)
        if (note) {
          osmDownUntil = Date.now() + OSM_BACKOFF_MS;
          if (t.basis !== null) scores[t.id] = summarize(t.total, t.scores, t.basis);
          continue;
        }
        avail = new Set(QUICK_CATS);
      } else {
        full++;
        const key = `${t.lng.toFixed(1)}:${t.lat.toFixed(1)}`;
        avail = availCache.get(key) ?? (await availableCategories(t.lng, t.lat));
        availCache.set(key, avail);
      }
      const [pois, development] = await Promise.all([poisNear(t.lng, t.lat), developmentSummary(t.lng, t.lat, t.build_year)]);
      const [total, result] = scorePoint(
        kind === "quick" ? pois.filter((p) => QUICK_CATS.includes(p.category)) : pois,
        avail,
        t.lng,
        t.lat,
      );
      await save(t.id, total, result, development, kind);
      scores[t.id] = summarize(total, result, kind);
    } catch (e) {
      console.warn("[location-live]", t.id, e instanceof Error ? e.message : e);
    }
  }
  return { scores, pending };
}
