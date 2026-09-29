import "server-only";
import { sql } from "../db";

export type Notification = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  priority: number;
  created_at: string;
  read_at: string | null;
  watch_item_id: string | null;
  item_label: string | null;
  payload: Record<string, unknown>;
};

export async function listNotifications(userId: string, opts: { limit?: number; unreadOnly?: boolean; kind?: string; itemId?: string } = {}) {
  return sql<Notification[]>`
    select n.id, n.kind, n.title, n.body, n.url, n.priority, n.created_at::text, n.read_at::text, n.watch_item_id,
      w.label as item_label, n.payload
    from notifications n left join watch_items w on w.id = n.watch_item_id
    where n.user_id = ${userId}
      ${opts.unreadOnly ? sql`and n.read_at is null` : sql``}
      ${opts.kind ? sql`and n.kind = ${opts.kind}` : sql``}
      ${opts.itemId ? sql`and n.watch_item_id = ${opts.itemId}` : sql``}
    order by n.created_at desc, n.priority desc
    limit ${opts.limit ?? 100}`;
}

export type ItemArticle = {
  link_id: number;
  title: string;
  url: string;
  source: string | null;
  published_at: string | null;
  relevance: number | null;
  category: string | null;
  impact: number | null;
  ai_summary: string | null;
  description: string | null;
  status: string;
  /** 이 기사를 찾은 검색 키워드 */
  query: string | null;
  /** 제목·요약에 키워드의 핵심어(첫 단어)가 실제로 나오는지 — 네이버 검색은 느슨하게 맞춰 무관한 기사가 섞인다 */
  mentioned: boolean;
  /** 내 지역 이름이 함께 나오는지 */
  local: boolean;
};

/**
 * 부동산 관련 뉴스. AI 분류가 끝난 것은 관련도 기준으로 거르고, 분류 전(또는 AI 키가 없을 때)은
 * 구체적인 키워드(단지명 → 동 → 시군구 순, keywords 배열 순서)로 찾았고 제목·요약에 실제로 언급된 기사를 앞에 둔다.
 */
/** 주소에서 지역 이름 조각(시·구·읍면동, 끝 글자 뺀 형태도): "경기도 수원시 영통구 이의동 1353" → [수원, 영통, 이의동, 이의] */
export function regionWordsOf(address: string | null): string[] {
  if (!address) return [];
  const out = new Set<string>();
  for (const t of address.replace(/\(.*?\)/g, " ").split(/\s+/).slice(1)) {
    if (!/^[가-힣]{2,}(시|군|구|읍|면|동|리)$/.test(t)) continue;
    out.add(t);
    const stem = t.slice(0, -1);
    if (stem.length >= 2) out.add(stem);
  }
  return [...out];
}

export async function itemArticles(itemId: string, minRelevance = 0.5, limit = 50, regionWords: string[] = []) {
  // 내 지역 이름(수원·영통·이의동 등)이 함께 나오는 기사 — 같은 이름의 다른 지역 단지 기사를 뒤로 보낸다
  const local = regionWords.length
    ? sql`(a.title || ' ' || coalesce(a.description, '')) ilike any(${regionWords.map((w) => `%${w}%`)})`
    : sql`false`;
  return sql<ItemArticle[]>`
    select l.id as link_id, a.title, a.url, a.source, a.published_at::text, l.relevance, l.category, l.impact,
      l.ai_summary, a.description, l.status, l.query, ${local} as local,
      coalesce(a.title || ' ' || coalesce(a.description, ''), '') ilike '%' || split_part(coalesce(l.query, ''), ' ', 1) || '%' as mentioned
    from article_links l join articles a on a.id = l.article_id join watch_items w on w.id = l.watch_item_id
    where l.watch_item_id = ${itemId}
      and (l.status <> 'classified' or l.relevance >= ${minRelevance})
      and a.published_at > now() - interval '90 days'
    order by (l.status = 'classified') desc,
      ${local} desc,
      (coalesce(a.title || ' ' || coalesce(a.description, ''), '') ilike '%' || split_part(coalesce(l.query, ''), ' ', 1) || '%') desc,
      coalesce(array_position(w.keywords, l.query), 99),
      a.published_at desc
    limit ${limit}`;
}

export type NearEvent = {
  id: number;
  kind: string;
  title: string;
  starts_on: string | null;
  ends_on: string | null;
  address: string | null;
  source_url: string | null;
  payload: Record<string, unknown>;
  dist_m: number | null;
  lng: number | null;
  lat: number | null;
};

export async function eventsNear(lng: number, lat: number, radiusM: number, fromDaysAgo = 60) {
  return sql<NearEvent[]>`
    select id, kind, title, starts_on::text, ends_on::text, address, source_url, payload, ST_X(geom) as lng, ST_Y(geom) as lat,
      ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)::int as dist_m
    from events
    where geom is not null and ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM})
      and coalesce(ends_on, starts_on) >= current_date - ${fromDaysAgo}::int
    order by starts_on nulls last
    limit 30`;
}

export type CalendarEntry = { date: string; kind: string; title: string; sub?: string | null; href?: string | null };

/** 캘린더: 이벤트(청약·입주·공시·세금) + 관심 부동산 만기(대출·임대) */
export async function calendarEntries(userId: string, from: string, to: string): Promise<CalendarEntry[]> {
  const evs = await sql<{ starts_on: string; ends_on: string | null; kind: string; title: string; source_url: string | null; near: string | null }[]>`
    select e.starts_on::text, e.ends_on::text, e.kind, e.title, e.source_url,
      (select w.label from watch_items w where w.user_id = ${userId} and w.geom is not null and e.geom is not null
         and ST_DWithin(w.geom::geography, e.geom::geography, 10000)
         order by ST_Distance(w.geom::geography, e.geom::geography) limit 1) as near
    from events e
    where e.starts_on between ${from} and ${to}
      and (e.kind not in ('subscription', 'move_in') or exists (
        select 1 from watch_items w where w.user_id = ${userId} and w.geom is not null and e.geom is not null
          and ST_DWithin(w.geom::geography, e.geom::geography, 10000)))
    order by e.starts_on`;
  const items = await sql<{ id: string; label: string; lease: { end_date?: string; role?: string } | null; loans: { name?: string; maturity?: string }[] }[]>`
    select id, label, lease, loans from watch_items where user_id = ${userId}`;
  const out: CalendarEntry[] = evs.map((e) => ({
    date: e.starts_on,
    kind: e.kind,
    title: e.title,
    sub: [e.ends_on && e.ends_on !== e.starts_on ? `~${e.ends_on.slice(5)}` : null, e.near ? `${e.near} 근처` : null].filter(Boolean).join(" · ") || null,
    href: e.source_url,
  }));
  for (const it of items) {
    if (it.lease?.end_date && it.lease.end_date >= from && it.lease.end_date <= to)
      out.push({ date: it.lease.end_date, kind: "lease", title: `${it.label} 임대차 만기`, href: `/items/${it.id}` });
    for (const l of it.loans ?? [])
      if (l.maturity && l.maturity >= from && l.maturity <= to)
        out.push({ date: l.maturity, kind: "loan", title: `${it.label} ${l.name ?? "대출"} 만기`, href: `/items/${it.id}` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
