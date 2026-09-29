import type { Metadata } from "next";
import { type MapEvent, type MapFocusComplex, type MapProject, type MapWatchItem, RealtyMap } from "@/components/map/realty-map";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { fillMissingItemGeoms } from "@/lib/external/geocode";
import { env } from "@/lib/env";
import { getAreaUnit } from "@/lib/area-unit";

export const metadata: Metadata = { title: "지도" };

export default async function MapPage(props: PageProps<"/map">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  const user = await requireUser();
  // 좌표가 없는 부동산(등록 때 지오코딩 실패 등)은 지금 채워 지도에 빠지지 않게 한다
  await fillMissingItemGeoms(user.id).catch((e) => console.error("[map] geocode", e));
  const [items, missing, events, projects, unit] = await Promise.all([
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
    sql<MapProject[]>`
      select 'zone' as type, id, name, kind, stage as status, stage_order as step, null::text as expected_open,
        ST_X(ST_PointOnSurface(geom)) as lng, ST_Y(ST_PointOnSurface(geom)) as lat
      from redevelopment_zones where geom is not null
      union all
      select 'infra', id, name, kind, status, status_order, expected_open::text,
        ST_X(ST_PointOnSurface(geom)), ST_Y(ST_PointOnSurface(geom))
      from infra_projects where geom is not null
      limit 1000`,
    getAreaUnit(),
  ]);
  const focus = typeof sp.item === "string" ? items.find((i) => i.id === sp.item) : undefined;
  // ?complex=단지 id: 그 단지를 골라 연다(단지 상세·유사 단지에서) / ?at=경도,위도&type=: 그 위치(단지 없는 거래)
  const complexId = typeof sp.complex === "string" ? Number(sp.complex) : NaN;
  const [focusComplex] = Number.isInteger(complexId)
    ? await sql<MapFocusComplex[]>`
        select id::int as id, name, property_type, ST_X(geom) as lng, ST_Y(geom) as lat from complexes where id = ${complexId} and geom is not null`
    : [];
  const at = typeof sp.at === "string" ? sp.at.split(",").map(Number) : null;
  const atPoint: [number, number] | null = at && at.length === 2 && at.every(Number.isFinite) ? [at[0], at[1]] : null;
  const center: [number, number] = focusComplex
    ? [focusComplex.lng, focusComplex.lat]
    : atPoint ?? (focus ? [focus.lng, focus.lat] : items[0] ? [items[0].lng, items[0].lat] : [126.978, 37.5665]);
  const initialType = typeof sp.type === "string" ? sp.type : focusComplex?.property_type ?? null;
  const myComplexes = Object.fromEntries(items.filter((i) => i.complex_id !== null).map((i) => [i.complex_id!, i.id]));
  return (
    <RealtyMap
      keyId={env.ncpKeyId ?? null}
      vworldKey={env.vworldKey ?? null}
      vworldDomain={env.vworldDomain ?? null}
      items={items}
      events={events}
      projects={projects}
      initialCenter={center}
      focusItemId={focusComplex || atPoint ? null : (focus?.id ?? null)}
      focusComplex={focusComplex ?? null}
      atPoint={atPoint}
      initialType={initialType}
      complexItems={myComplexes}
      unit={unit}
      missingItems={missing}
    />
  );
}
