import type { Metadata } from "next";
import { cookies } from "next/headers";
import { type MapEvent, type MapFocusComplex, type MapFocusProject, type MapWatchItem, RealtyMap } from "@/components/map/realty-map";
import { pageUser, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { fillMissingItemGeoms } from "@/lib/external/geocode";
import { env } from "@/lib/env";
import { getAreaUnit } from "@/lib/area-unit";
import { busiestCenter } from "@/lib/queries/complexes";
import { MAP_LAYER_KEYS, MAP_PREFS_COOKIE, parseMapPrefs } from "@/lib/map-prefs";

export const metadata: Metadata = { title: "지도" };

export default async function MapPage(props: PageProps<"/map">) {
  const [uid, sp, jar] = await Promise.all([sessionUserId(), props.searchParams, cookies()]);
  // 이 기기에서 마지막으로 쓴 지도 설정(유형·조건·레이어 등)
  const prefs = parseMapPrefs(jar.get(MAP_PREFS_COOKIE)?.value);
  // 시작 화면이라 방문자도 바로 본다(내 부동산 목록만 비어 있다)
  const user = await pageUser(uid);
  // 좌표가 없는 부동산(등록 때 지오코딩 실패 등)은 지금 채워 지도에 빠지지 않게 한다
  if (user?.itemCount) await fillMissingItemGeoms(user.id).catch((e) => console.error("[map] geocode", e));
  const [items, missing, events, unit] = await Promise.all([
    sql<MapWatchItem[]>`
      select w.id, w.label, w.property_type, w.group_tag, w.radius_m, w.complex_id, w.pnu, w.area_m2::float8 as area_m2,
        ST_X(w.geom) as lng, ST_Y(w.geom) as lat, v.estimate, lt.price as last_price, lt.deal_date::text as last_date
      from watch_items w
      left join lateral (select estimate from valuations where watch_item_id = w.id order by as_of desc limit 1) v on true
      left join lateral (
        select t.price, t.deal_date from transactions t
        where t.complex_id = w.complex_id and w.complex_id is not null and t.deal_kind = 'sale' and not t.is_canceled
          and (w.area_m2 is null or abs(t.area_m2 - w.area_m2) <= 3)
        order by t.deal_date desc limit 1) lt on true
      where w.user_id = ${uid} and w.geom is not null order by w.sort_order, w.created_at`,
    sql<{ id: string; label: string }[]>`
      select id, label from watch_items where user_id = ${uid} and geom is null order by sort_order, created_at`,
    sql<MapEvent[]>`
      select id, title, kind, ST_X(geom) as lng, ST_Y(geom) as lat, starts_on::text as starts_on,
        nullif(regexp_replace(coalesce(payload->>'households', ''), '[^0-9]', '', 'g'), '')::int as households
      from events where geom is not null and (
        (kind = 'subscription' and coalesce(ends_on, starts_on) >= current_date - 30)
        or (kind = 'move_in' and starts_on between current_date - 90 and current_date + interval '36 months'))
      order by starts_on desc limit 400`,
    getAreaUnit(),
  ]);
  const focus = typeof sp.item === "string" ? items.find((i) => i.id === sp.item) : undefined;
  // ?complex=단지 id: 그 단지를 골라 연다(단지 상세·유사 단지에서) / ?at=경도,위도&type=: 그 위치(단지 없는 거래)
  const complexId = typeof sp.complex === "string" ? Number(sp.complex) : NaN;
  const [focusComplex] = Number.isInteger(complexId)
    ? await sql<MapFocusComplex[]>`
        select id::int as id, name, property_type, ST_X(geom) as lng, ST_Y(geom) as lat from complexes where id = ${complexId} and geom is not null`
    : [];
  // ?zone=정비구역 id / ?infra=철도·도로 사업 id: 그 사업으로 이동해 레이어를 켜고 경계를 강조하며 정보 카드를 연다(개발·테마에서)
  const zoneId = typeof sp.zone === "string" ? Number(sp.zone) : NaN;
  const infraId = typeof sp.infra === "string" ? Number(sp.infra) : NaN;
  const [focusProject] = Number.isInteger(zoneId)
    ? await sql<MapFocusProject[]>`
        select 'zone' as type, id::int as id, name, kind, stage as status, stage_order as step, null::text as expected_open,
          ST_X(ST_PointOnSurface(geom)) as lng, ST_Y(ST_PointOnSurface(geom)) as lat,
          coalesce((attrs->>'candidate')::boolean, false) as candidate, area_m2::float8 as area_m2,
          case when GeometryType(geom) like '%POLYGON' then ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.00002)), 6) end as shape
        from redevelopment_zones where id = ${zoneId} and geom is not null`
    : Number.isInteger(infraId)
      ? await sql<MapFocusProject[]>`
          select 'infra' as type, id::int as id, name, kind, status, status_order as step, expected_open::text,
            ST_X(ST_PointOnSurface(geom)) as lng, ST_Y(ST_PointOnSurface(geom)) as lat, attrs->>'notice_date' as notice_date,
            case when kind = 'road' then ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.00002)), 6) end as shape
          from infra_projects where id = ${infraId} and geom is not null`
      : [];
  const at = typeof sp.at === "string" ? sp.at.split(",").map(Number) : null;
  const atPoint: [number, number] | null = at && at.length === 2 && at.every(Number.isFinite) ? [at[0], at[1]] : null;
  const center: [number, number] = focusProject
    ? [focusProject.lng, focusProject.lat]
    : focusComplex
    ? [focusComplex.lng, focusComplex.lat]
    : (atPoint ??
      (focus ? [focus.lng, focus.lat] : items[0] ? [items[0].lng, items[0].lat] : ((await busiestCenter().catch(() => null)) ?? [126.978, 37.5665])));
  const initialType = typeof sp.type === "string" ? sp.type : focusComplex?.property_type ?? null;
  const myComplexes = Object.fromEntries(items.filter((i) => i.complex_id !== null).map((i) => [i.complex_id!, i.id]));
  return (
    <RealtyMap
      keyId={env.ncpKeyId ?? null}
      vworldKey={env.vworldKey ?? null}
      vworldDomain={env.vworldDomain ?? null}
      items={items}
      events={events}
      initialCenter={center}
      focusItemId={focusComplex || atPoint || focusProject ? null : (focus?.id ?? null)}
      focusProject={focusProject ?? null}
      focusComplex={focusComplex ?? null}
      atPoint={atPoint}
      initialType={initialType}
      initialLayers={[
        ...(typeof sp.layers === "string" ? sp.layers.split(",").flatMap((l) => (l === "projects" ? ["zones", "infra"] : [l])).filter((l) => (MAP_LAYER_KEYS as readonly string[]).includes(l)) : []),
        ...(focusProject ? [focusProject.type === "zone" ? "zones" : "infra"] : []),
      ]}
      initialPrefs={prefs}
      complexItems={myComplexes}
      unit={unit}
      missingItems={missing}
    />
  );
}
