import type { Metadata } from "next";
import { type MapEvent, type MapProject, type MapWatchItem, RealtyMap } from "@/components/map/realty-map";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "지도" };

export default async function MapPage(props: PageProps<"/map">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const items = await sql<MapWatchItem[]>`
    select id, label, property_type, radius_m, ST_X(geom) as lng, ST_Y(geom) as lat
    from watch_items where user_id = ${user.id} and geom is not null order by sort_order, created_at`;
  const events = await sql<MapEvent[]>`
    select id, title, kind, ST_X(geom) as lng, ST_Y(geom) as lat, starts_on::text as starts_on
    from events where geom is not null and kind = 'subscription' and coalesce(ends_on, starts_on) >= current_date - 30
    order by starts_on desc limit 200`;
  const projects = await sql<MapProject[]>`
    select 'zone' as type, id, name, kind, stage as status, stage_order as step, null::text as expected_open,
      ST_X(ST_PointOnSurface(geom)) as lng, ST_Y(ST_PointOnSurface(geom)) as lat
    from redevelopment_zones where geom is not null
    union all
    select 'infra', id, name, kind, status, status_order, expected_open::text,
      ST_X(ST_PointOnSurface(geom)), ST_Y(ST_PointOnSurface(geom))
    from infra_projects where geom is not null
    limit 1000`;
  const focus = typeof sp.item === "string" ? items.find((i) => i.id === sp.item) : undefined;
  const center: [number, number] = focus ? [focus.lng, focus.lat] : items[0] ? [items[0].lng, items[0].lat] : [126.978, 37.5665];
  return <RealtyMap keyId={env.ncpKeyId ?? null} items={items} events={events} projects={projects} initialCenter={center} />;
}
