import "server-only";
import { sql } from "../db";

/**
 * OpenStreetMap(Overpass API) 주변 시설 — 키 없이 쓰는 보조 원천. 수집된 시설(pois)이 없는 곳에서
 * 지도 레이어(지하철·학교·공원·병원·마트)가 비지 않게 채운다. 0.02° 격자 단위로 받아 pois(source='osm')에 저장하고,
 * poi_fetches 에 기록해 30일 동안 다시 받지 않는다(ETL collectors/osm.py 와 같은 분류).
 */
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const GRID = 0.02;
/** 한 번에 받을 최대 격자 수(화면이 넓으면 받지 않는다) */
const MAX_TILES = 12;

type Poi = { source_id: string; category: string; subcategory: string | null; name: string; lng: number; lat: number };

function classify(tags: Record<string, string>): [string, string | null] | null {
  const name = tags["name:ko"] ?? tags.name ?? "";
  if (tags.railway === "station" || tags.station === "subway") return ["subway", tags.station ?? tags.railway ?? null];
  if (tags.amenity === "school") {
    const sub = ["초등학교", "중학교", "고등학교"].find((s) => name.endsWith(s));
    return ["school", sub ?? null];
  }
  if (tags.leisure === "park") return ["park", null];
  if (tags.amenity === "hospital") return ["hospital", name.includes("대학교") || name.includes("대학병원") ? "상급종합" : name.includes("종합병원") ? "종합병원" : "병원"];
  if (["supermarket", "department_store", "mall"].includes(tags.shop ?? "")) return ["mart", tags.shop];
  return null;
}

function tilesOf([minx, miny, maxx, maxy]: number[]) {
  const out: [number, number][] = [];
  for (let x = Math.floor(minx / GRID); x <= Math.floor(maxx / GRID); x++) {
    for (let y = Math.floor(miny / GRID); y <= Math.floor(maxy / GRID); y++) out.push([x, y]);
  }
  return out;
}

async function overpass(bbox: [number, number, number, number], timeoutMs = 40_000): Promise<Poi[]> {
  // 미러마다 최대 20초, 전체는 timeoutMs 안에서(지도 즉석 계산은 짧게)
  const deadline = Date.now() + timeoutMs;
  const [w, s, e, n] = bbox;
  const b = `(${s},${w},${n},${e})`;
  const q = `[out:json][timeout:20];(nwr["railway"="station"]${b};nwr["station"="subway"]${b};nwr["amenity"="school"]${b};nwr["leisure"="park"]${b};nwr["amenity"="hospital"]${b};nwr["shop"~"^(supermarket|department_store|mall)$"]${b};);out center tags;`;
  let last: unknown = null;
  for (const url of ENDPOINTS) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: q }),
        headers: { "User-Agent": "MyRealty/0.1" },
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(20_000, left)),
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const data = (await res.json()) as { elements?: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };
      const out: Poi[] = [];
      for (const el of data.elements ?? []) {
        const tags = el.tags ?? {};
        const c = classify(tags);
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        const name = tags["name:ko"] ?? tags.name ?? (c?.[0] === "park" ? "공원" : "");
        if (!c || lat == null || lng == null || !name) continue;
        out.push({ source_id: `${el.type}/${el.id}`, category: c[0], subcategory: c[1], name: name.slice(0, 200), lng, lat });
      }
      return out;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("Overpass 실패");
}

/** 화면 범위에서 아직 받지 않은 격자를 OSM 에서 받아 저장한다. 결과 메모(화면 표시용)를 돌려준다 */
export async function ensureOsmPois(bbox: [number, number, number, number], { timeoutMs }: { timeoutMs?: number } = {}): Promise<string | null> {
  const tiles = tilesOf(bbox);
  if (tiles.length > MAX_TILES) return "넓은 범위에서는 주변 시설을 새로 불러오지 않습니다. 확대하면 보입니다.";
  const keys = tiles.map(([x, y]) => `osmweb:${x}:${y}`);
  const fresh = await sql<{ key: string }[]>`
    select key from poi_fetches where key = any(${keys}) and fetched_at > now() - interval '30 days'`;
  const have = new Set(fresh.map((r) => r.key));
  const need = tiles.filter((_, i) => !have.has(keys[i]));
  if (!need.length) return null;
  const minx = Math.min(...need.map((t) => t[0])) * GRID;
  const miny = Math.min(...need.map((t) => t[1])) * GRID;
  const maxx = (Math.max(...need.map((t) => t[0])) + 1) * GRID;
  const maxy = (Math.max(...need.map((t) => t[1])) + 1) * GRID;
  let rows: Poi[];
  try {
    rows = await overpass([minx, miny, maxx, maxy], timeoutMs);
  } catch (e) {
    console.warn("[osm]", e instanceof Error ? e.message : e);
    return "주변 시설(OpenStreetMap)을 불러오지 못했습니다. 잠시 뒤 다시 시도합니다.";
  }
  if (rows.length) {
    await sql`
      insert into pois (source, source_id, category, subcategory, name, geom, updated_at)
      select 'osm', x.source_id, x.category, x.subcategory, x.name, ST_SetSRID(ST_MakePoint(x.lng, x.lat), 4326), now()
      from jsonb_to_recordset(${sql.json(rows)}) as x(source_id text, category text, subcategory text, name text, lng float8, lat float8)
      on conflict (source, source_id) do update set category = excluded.category, subcategory = excluded.subcategory,
        name = excluded.name, geom = excluded.geom, updated_at = now()`;
  }
  const doneKeys = need.map(([x, y]) => `osmweb:${x}:${y}`);
  await sql`
    insert into poi_fetches (key, fetched_at, count)
    select k, now(), ${rows.length} from unnest(${doneKeys}::text[]) as k
    on conflict (key) do update set fetched_at = now(), count = excluded.count`;
  return null;
}
