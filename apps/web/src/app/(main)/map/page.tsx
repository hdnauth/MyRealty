import type { Metadata } from "next";
import { type MapEvent, type MapProject, type MapWatchItem, RealtyMap } from "@/components/map/realty-map";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { getAreaUnit } from "@/lib/area-unit";

export const metadata: Metadata = { title: "지도" };

export default async function MapPage(props: PageProps<"/map">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  const [, items, events, projects, unit] = await Promise.all([
    requireUser(),
    sql<MapWatchItem[]>`
      select id, label, property_type, radius_m, ST_X(geom) as lng, ST_Y(geom) as lat
      from watch_items where user_id = ${uid} and geom is not null order by sort_order, created_at`,
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
  const center: [number, number] = focus ? [focus.lng, focus.lat] : items[0] ? [items[0].lng, items[0].lat] : [126.978, 37.5665];
  return <RealtyMap keyId={env.ncpKeyId ?? null} vworldKey={env.vworldKey ?? null} vworldDomain={env.vworldDomain ?? null} items={items} events={events} projects={projects} initialCenter={center} unit={unit} />;
}
