import "server-only";
import { cache } from "react";
import { sql } from "../db";
import { excerpt, levelOf } from "./rules";

export type CommunityMe = {
  id: string;
  nickname: string | null;
  agreedAt: string | null;
  mutedUntil: string | null;
  points: number;
  createdAt: string;
  showOwner: boolean;
  isAdmin: boolean;
};

/** 커뮤니티용 내 정보. 글쓰기는 닉네임 + 운영 원칙 동의가 있어야 한다 */
export const communityMe = cache(async (uid: string, isAdmin = false): Promise<CommunityMe> => {
  const [r] = await sql<{ nickname: string | null; agreed: string | null; muted: string | null; points: number; created: string; settings: { communityShowOwner?: boolean } }[]>`
    select nickname, community_agreed_at::text as agreed,
           case when community_muted_until > now() then community_muted_until::text end as muted,
           community_points as points, created_at::text as created, settings
    from users where id = ${uid}`;
  return {
    id: uid,
    nickname: r?.nickname ?? null,
    agreedAt: r?.agreed ?? null,
    mutedUntil: r?.muted ?? null,
    points: r?.points ?? 0,
    createdAt: r?.created ?? new Date().toISOString(),
    showOwner: r?.settings?.communityShowOwner === true,
    isAdmin,
  };
});

export const canWrite = (me: CommunityMe) => Boolean(me.nickname && me.agreedAt);

// ───────── 지역·단지 이름 ─────────

export async function sggNames(codes: string[]): Promise<Record<string, string>> {
  if (!codes.length) return {};
  const rows = await sql<{ sgg: string; name: string | null }[]>`
    select c.sgg, coalesce(t.name, nullif(trim(concat_ws(' ', r.sido, r.sigungu)), '')) as name
    from unnest(${codes}::text[]) as c(sgg)
    left join collect_targets t on t.sgg_cd = c.sgg
    left join regions r on r.lawd_cd = c.sgg || '00000'`;
  return Object.fromEntries(rows.map((r) => [r.sgg, r.name ?? r.sgg]));
}

/** "서울특별시 송파구" → "송파구" */
export function shortSgg(name: string | null | undefined) {
  if (!name) return "";
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

// ───────── 구독 ─────────

export type Subscriptions = {
  sggs: { sgg: string; name: string; auto: boolean }[];
  complexes: { id: number; name: string; sgg: string; auto: boolean }[];
};

/** 관심 부동산의 시군구·단지(자동) + 직접 구독 */
export const subscriptions = cache(async (uid: string): Promise<Subscriptions> => {
  const [autoS, autoC, follows] = await Promise.all([
    sql<{ sgg: string }[]>`select distinct sgg_cd as sgg from watch_items where user_id = ${uid} and sgg_cd is not null`,
    sql<{ id: number; name: string; sgg: string }[]>`
      select distinct c.id, c.name, c.sgg_cd as sgg from watch_items w join complexes c on c.id = w.complex_id where w.user_id = ${uid}`,
    sql<{ scope: string; scope_id: string }[]>`select scope, scope_id from community_follows where user_id = ${uid} order by created_at`,
  ]);
  const followC = follows.filter((f) => f.scope === "complex").map((f) => Number(f.scope_id)).filter((id) => !autoC.some((c) => c.id === id));
  const extraC = followC.length
    ? await sql<{ id: number; name: string; sgg: string }[]>`select id, name, sgg_cd as sgg from complexes where id = any(${followC})`
    : [];
  const sggSet = [...new Set([...autoS.map((s) => s.sgg), ...follows.filter((f) => f.scope === "sgg").map((f) => f.scope_id)])];
  const names = await sggNames(sggSet);
  return {
    sggs: sggSet.map((sgg) => ({ sgg, name: names[sgg] ?? sgg, auto: autoS.some((s) => s.sgg === sgg) })).sort((a, b) => a.name.localeCompare(b.name)),
    complexes: [...autoC.map((c) => ({ ...c, auto: true })), ...extraC.map((c) => ({ ...c, auto: false }))],
  };
});

export async function isFollowing(uid: string, scope: "sgg" | "complex", id: string) {
  const [r] = await sql`select 1 from community_follows where user_id = ${uid} and scope = ${scope} and scope_id = ${id}`;
  return Boolean(r);
}

// ───────── 글 목록 ─────────

export type Badge = "resident" | "owner" | "watcher";
export type PostRow = {
  id: number;
  title: string;
  excerpt: string;
  category: string;
  kind: "user" | "system";
  status: string;
  sgg_cd: string;
  sgg_name: string;
  complex_id: number | null;
  complex_name: string | null;
  like_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
  edited_at: string | null;
  author: Author;
  has_poll: boolean;
  image_count: number;
  attach_count: number;
  liked: boolean;
  mine: boolean;
};
export type Author = { id: string | null; nickname: string; level: string; badges: Badge[]; isAi?: boolean };

export type ListOpts = {
  uid: string;
  sgg?: string | null;
  complexId?: number | null;
  /** 구독 피드: 이 시군구들 + 이 단지들 */
  feed?: { sggs: string[]; complexIds: number[] } | null;
  category?: string | null;
  sort?: "new" | "hot";
  q?: string | null;
  /** 단지 탭에서 같은 시군구 인기글을 섞을 때 그 단지 글은 빼기 */
  excludeComplex?: number | null;
  userId?: string | null;
  limit?: number;
  offset?: number;
};

type RawPost = Omit<PostRow, "author" | "excerpt" | "sgg_name"> & {
  body: string;
  user_id: string | null;
  nickname: string | null;
  points: number | null;
  resident: boolean;
  owner: boolean;
  watcher: boolean;
};

function toAuthor(r: { user_id: string | null; nickname: string | null; points: number | null; resident: boolean; owner: boolean; watcher: boolean }, kind: string): Author {
  if (kind === "system") return { id: null, nickname: "마이리얼티 데이터", level: "", badges: [] };
  if (!r.user_id) return { id: null, nickname: "탈퇴한 사용자", level: "", badges: [] };
  const badges: Badge[] = [];
  if (r.resident) badges.push("resident");
  else if (r.owner) badges.push("owner");
  else if (r.watcher) badges.push("watcher");
  return { id: r.user_id, nickname: r.nickname ?? "이름 없음", level: levelOf(r.points ?? 0).label, badges };
}

/**
 * 글 목록. 보이는 글(visible) + 내가 쓴 검토 중 글. 작성자 배지는 글의 단지(없으면 시군구) 기준:
 * 거주 인증 > 보유(본인이 공개 설정한 경우) > 관심 등록.
 */
export async function listPosts(o: ListOpts): Promise<PostRow[]> {
  const limit = Math.min(o.limit ?? 20, 50);
  const q = o.q?.trim() ? o.q.trim().slice(0, 50) : null;
  const sggs = o.feed?.sggs ?? null;
  const cids = o.feed?.complexIds ?? null;
  const rows = await sql<RawPost[]>`
    select p.id, p.title, p.body, p.category, p.kind, p.status, p.sgg_cd, p.complex_id, c.name as complex_name,
           p.like_count, p.comment_count, p.view_count, p.created_at::text, p.edited_at::text,
           p.user_id, u.nickname, u.community_points as points,
           exists (select 1 from community_polls pl where pl.post_id = p.id) as has_poll,
           (select count(*)::int from jsonb_array_elements(p.attachments) a where a->>'type' = 'image') as image_count,
           jsonb_array_length(p.attachments) as attach_count,
           exists (select 1 from community_reactions r where r.target_type = 'post' and r.target_id = p.id and r.user_id = ${o.uid}) as liked,
           (p.user_id = ${o.uid}) as mine,
           ${badgeSql()}
    from community_posts p
    left join users u on u.id = p.user_id
    left join complexes c on c.id = p.complex_id
    where (p.status = 'visible' or (p.status = 'held' and p.user_id = ${o.uid}))
      and (${o.sgg ?? null}::text is null or p.sgg_cd = ${o.sgg ?? null})
      and (${o.complexId ?? null}::bigint is null or p.complex_id = ${o.complexId ?? null})
      and (${o.excludeComplex ?? null}::bigint is null or p.complex_id is distinct from ${o.excludeComplex ?? null})
      and (${sggs}::text[] is null or p.sgg_cd = any(${sggs}::text[]) or p.complex_id = any(${cids ?? []}::bigint[]))
      and (${o.category ?? null}::text is null or p.category = ${o.category ?? null})
      and (${o.userId ?? null}::uuid is null or p.user_id = ${o.userId ?? null})
      and (${q}::text is null or (p.title || ' ' || p.body) ilike '%' || ${q} || '%')
      and not exists (select 1 from community_blocks b where b.user_id = ${o.uid} and b.blocked_id = p.user_id)
    order by ${
      o.sort === "hot"
        ? // 인기: 최근 14일 안에서 좋아요·댓글 가중, 오래될수록 감쇠
          sql`(case when p.created_at > now() - interval '14 days' then 1 else 0 end) desc,
              (p.like_count * 2 + p.comment_count * 3 + p.view_count * 0.05) / power(extract(epoch from now() - p.created_at) / 3600 + 2, 1.2) desc`
        : sql`p.created_at desc`
    }, p.id desc
    limit ${limit} offset ${o.offset ?? 0}`;
  const names = await sggNames([...new Set(rows.map((r) => r.sgg_cd))]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    excerpt: excerpt(r.body),
    category: r.category,
    kind: r.kind,
    status: r.status,
    sgg_cd: r.sgg_cd,
    sgg_name: names[r.sgg_cd] ?? r.sgg_cd,
    complex_id: r.complex_id,
    complex_name: r.complex_name,
    like_count: r.like_count,
    comment_count: r.comment_count,
    view_count: r.view_count,
    created_at: r.created_at,
    edited_at: r.edited_at,
    author: toAuthor(r, r.kind),
    has_poll: r.has_poll,
    image_count: r.image_count,
    attach_count: r.attach_count,
    liked: r.liked,
    mine: r.mine,
  }));
}

/** 작성자 배지(글 p, 작성자 u 기준) */
function badgeSql() {
  return sql`
    coalesce(p.complex_id is not null and exists (
      select 1 from community_residences rs where rs.user_id = p.user_id and rs.complex_id = p.complex_id
        and rs.verified_at is not null and rs.expires_at > now()), false) as resident,
    coalesce(coalesce((u.settings->>'communityShowOwner')::boolean, false) and exists (
      select 1 from watch_items w where w.user_id = p.user_id and w.group_tag = 'owned'
        and (w.complex_id = p.complex_id or (p.complex_id is null and w.sgg_cd = p.sgg_cd))), false) as owner,
    exists (select 1 from watch_items w where w.user_id = p.user_id
        and (w.complex_id = p.complex_id or (p.complex_id is null and w.sgg_cd = p.sgg_cd))) as watcher`;
}

// ───────── 글 상세 ─────────

export type Attachment =
  | { type: "trade"; id: number }
  | { type: "complex"; id: number; area?: number | null }
  | { type: "series"; code: string }
  | { type: "image"; id: string };

export type PostDetail = PostRow & {
  body: string;
  attachments: Attachment[];
  moderation: { flags?: { code: string; label: string }[]; ai?: { verdict: string; reason?: string } };
  report_count: number;
  reported: boolean;
  /** 내가 차단한 사용자의 글(본문을 가린다) */
  blocked: boolean;
};

export async function getPost(id: number, uid: string, isAdmin = false): Promise<PostDetail | null> {
  const [r] = await sql<(RawPost & { attachments: Attachment[]; moderation: PostDetail["moderation"]; report_count: number; reported: boolean; blocked: boolean })[]>`
    select p.id, p.title, p.body, p.category, p.kind, p.status, p.sgg_cd, p.complex_id, c.name as complex_name,
           p.like_count, p.comment_count, p.view_count, p.created_at::text, p.edited_at::text, p.attachments, p.moderation, p.report_count,
           p.user_id, u.nickname, u.community_points as points,
           exists (select 1 from community_polls pl where pl.post_id = p.id) as has_poll,
           0 as image_count, jsonb_array_length(p.attachments) as attach_count,
           exists (select 1 from community_reactions r where r.target_type = 'post' and r.target_id = p.id and r.user_id = ${uid}) as liked,
           exists (select 1 from community_reports r where r.target_type = 'post' and r.target_id = p.id and r.reporter_id = ${uid}) as reported,
           exists (select 1 from community_blocks b where b.user_id = ${uid} and b.blocked_id = p.user_id) as blocked,
           (p.user_id = ${uid}) as mine,
           ${badgeSql()}
    from community_posts p
    left join users u on u.id = p.user_id
    left join complexes c on c.id = p.complex_id
    where p.id = ${id} and p.status <> 'deleted'`;
  if (!r) return null;
  if (r.status !== "visible" && !(r.mine || isAdmin)) return null;
  const names = await sggNames([r.sgg_cd]);
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    excerpt: excerpt(r.body),
    category: r.category,
    kind: r.kind,
    status: r.status,
    sgg_cd: r.sgg_cd,
    sgg_name: names[r.sgg_cd] ?? r.sgg_cd,
    complex_id: r.complex_id,
    complex_name: r.complex_name,
    like_count: r.like_count,
    comment_count: r.comment_count,
    view_count: r.view_count,
    created_at: r.created_at,
    edited_at: r.edited_at,
    author: toAuthor(r, r.kind),
    has_poll: r.has_poll,
    image_count: r.attachments.filter((a) => a.type === "image").length,
    attach_count: r.attach_count,
    liked: r.liked,
    mine: r.mine,
    attachments: r.attachments,
    moderation: r.moderation,
    report_count: r.report_count,
    reported: r.reported,
    blocked: r.blocked,
  };
}

export type CommentRow = {
  id: number;
  parent_id: number | null;
  body: string;
  kind: "user" | "ai";
  status: string;
  like_count: number;
  created_at: string;
  author: Author;
  liked: boolean;
  mine: boolean;
  reported: boolean;
  /** 내가 차단한 사용자의 댓글(본문을 비운다) */
  blocked: boolean;
};

export async function listComments(postId: number, uid: string, isAdmin = false): Promise<CommentRow[]> {
  const rows = await sql<(Omit<CommentRow, "author"> & { user_id: string | null; nickname: string | null; points: number | null; resident: boolean; owner: boolean; watcher: boolean })[]>`
    select m.id, m.parent_id, m.body, m.kind, m.status, m.like_count, m.created_at::text,
           m.user_id, u.nickname, u.community_points as points,
           exists (select 1 from community_reactions r where r.target_type = 'comment' and r.target_id = m.id and r.user_id = ${uid}) as liked,
           exists (select 1 from community_reports r where r.target_type = 'comment' and r.target_id = m.id and r.reporter_id = ${uid}) as reported,
           exists (select 1 from community_blocks b where b.user_id = ${uid} and b.blocked_id = m.user_id) as blocked,
           (m.user_id = ${uid}) as mine,
           ${sql`
             coalesce(p.complex_id is not null and exists (
               select 1 from community_residences rs where rs.user_id = m.user_id and rs.complex_id = p.complex_id
                 and rs.verified_at is not null and rs.expires_at > now()), false) as resident,
             coalesce(coalesce((u.settings->>'communityShowOwner')::boolean, false) and exists (
               select 1 from watch_items w where w.user_id = m.user_id and w.group_tag = 'owned'
                 and (w.complex_id = p.complex_id or (p.complex_id is null and w.sgg_cd = p.sgg_cd))), false) as owner,
             exists (select 1 from watch_items w where w.user_id = m.user_id
                 and (w.complex_id = p.complex_id or (p.complex_id is null and w.sgg_cd = p.sgg_cd))) as watcher`}
    from community_comments m
    join community_posts p on p.id = m.post_id
    left join users u on u.id = m.user_id
    where m.post_id = ${postId}
      and (m.status in ('visible', 'deleted') or (m.status = 'held' and (m.user_id = ${uid} or ${isAdmin})) or (m.status = 'hidden' and ${isAdmin}))
    order by coalesce(m.parent_id, m.id), m.parent_id nulls first, m.created_at`;
  return rows.map((r) => ({
    id: r.id,
    parent_id: r.parent_id,
    body: r.status === "deleted" || r.blocked ? "" : r.body,
    kind: r.kind,
    status: r.status,
    like_count: r.like_count,
    created_at: r.created_at,
    author: r.kind === "ai" ? { id: null, nickname: "AI 데이터 답변", level: "", badges: [], isAi: true } : toAuthor(r, "user"),
    liked: r.liked,
    mine: r.mine,
    reported: r.reported,
    blocked: r.blocked,
  }));
}

/** 내가 차단한 사용자 */
export async function listBlocks(uid: string) {
  return sql<{ id: string; nickname: string | null; created_at: string }[]>`
    select u.id, u.nickname, b.created_at::text from community_blocks b join users u on u.id = b.blocked_id
    where b.user_id = ${uid} order by b.created_at desc`;
}

// ───────── 첨부 데이터 ─────────

export type TradeCard = { id: number; complex_id: number | null; complex_name: string | null; deal_kind: string; deal_date: string; price: number; monthly_rent: number | null; area_m2: number | null; floor: number | null; is_canceled: boolean; is_direct: boolean | null; record_high: boolean };
export type ComplexCard = { id: number; name: string; property_type: string; build_year: number | null; households: number | null; umd_nm: string | null; median: number | null; trades: number; area: number | null };
export type SeriesCard = { code: string; name: string; unit: string | null; points: [string, number][] };

export async function loadAttachments(atts: Attachment[]) {
  const tradeIds = atts.filter((a) => a.type === "trade").map((a) => (a as { id: number }).id);
  const complexAtts = atts.filter((a): a is Extract<Attachment, { type: "complex" }> => a.type === "complex");
  const codes = atts.filter((a) => a.type === "series").map((a) => (a as { code: string }).code);
  const [trades, complexes, series] = await Promise.all([
    tradeIds.length
      ? sql<TradeCard[]>`
          select t.id, t.complex_id, c.name as complex_name, t.deal_kind, t.deal_date::text, t.price, t.monthly_rent, t.area_m2::float8 as area_m2,
                 t.floor, t.is_canceled, t.is_direct,
                 (t.deal_kind = 'sale' and not t.is_canceled and t.complex_id is not null and t.price > coalesce((
                   select max(x.price) from transactions x where x.complex_id = t.complex_id and x.deal_kind = 'sale' and not x.is_canceled
                     and abs(x.area_m2 - t.area_m2) <= 3 and x.deal_date < t.deal_date), 1e15)) as record_high
          from transactions t left join complexes c on c.id = t.complex_id where t.id = any(${tradeIds})`
      : [],
    Promise.all(
      complexAtts.map(async (a) => {
        const [c] = await sql<ComplexCard[]>`
          select c.id, c.name, c.property_type, c.build_year, c.households, c.umd_nm,
                 (select percentile_cont(0.5) within group (order by t.price)::float8 from transactions t
                   where t.complex_id = c.id and t.deal_kind = 'sale' and not t.is_canceled and t.deal_date > current_date - 365
                     and (${a.area ?? null}::numeric is null or abs(t.area_m2 - ${a.area ?? null}::numeric) <= 3)) as median,
                 (select count(*)::int from transactions t where t.complex_id = c.id and t.deal_kind = 'sale' and not t.is_canceled and t.deal_date > current_date - 365
                     and (${a.area ?? null}::numeric is null or abs(t.area_m2 - ${a.area ?? null}::numeric) <= 3)) as trades,
                 ${a.area ?? null}::float8 as area
          from complexes c where c.id = ${a.id}`;
        return c ?? null;
      }),
    ),
    codes.length
      ? sql<{ code: string; name: string; unit: string | null; points: [string, number][] }[]>`
          select s.code, s.name, s.unit,
                 coalesce((select jsonb_agg(jsonb_build_array(v.period::text, v.value) order by v.period)
                           from (select period, value from series_values where code = s.code order by period desc limit 36) v), '[]'::jsonb) as points
          from series s where s.code = any(${codes})`
      : [],
  ]);
  return {
    trades: new Map(trades.map((t) => [t.id, t])),
    complexes: new Map(complexes.filter(Boolean).map((c) => [c!.id, c!])),
    series: new Map(series.map((s) => [s.code, s as SeriesCard])),
  };
}

// ───────── 투표 ─────────

export type Poll = { kind: "custom" | "outlook"; question: string; options: string[]; closes_at: string | null; counts: number[]; total: number; myVote: number | null; closed: boolean };

export async function getPoll(postId: number, uid: string): Promise<Poll | null> {
  const [p] = await sql<{ kind: "custom" | "outlook"; question: string; options: string[]; closes_at: string | null; closed: boolean }[]>`
    select kind, question, options, closes_at::text, coalesce(closes_at < now(), false) as closed from community_polls where post_id = ${postId}`;
  if (!p) return null;
  const votes = await sql<{ option: number; n: number }[]>`select option, count(*)::int as n from community_poll_votes where post_id = ${postId} group by option`;
  const [mine] = await sql<{ option: number }[]>`select option from community_poll_votes where post_id = ${postId} and user_id = ${uid}`;
  const counts = p.options.map((_, i) => votes.find((v) => v.option === i)?.n ?? 0);
  return { ...p, counts, total: counts.reduce((a, b) => a + b, 0), myVote: mine?.option ?? null };
}

/** 가격 전망 투표 → 시군구 커뮤니티 심리(월별). 상승=+1, 보합=0, 하락=-1 평균(-100~100) */
export async function outlookSentiment(sgg: string) {
  return sql<{ month: string; score: number; votes: number; up: number; flat: number; down: number }[]>`
    select to_char(date_trunc('month', v.created_at), 'YYYY-MM') as month,
           round(avg(case v.option when 0 then 100 when 1 then 0 else -100 end))::int as score,
           count(*)::int as votes,
           count(*) filter (where v.option = 0)::int as up,
           count(*) filter (where v.option = 1)::int as flat,
           count(*) filter (where v.option = 2)::int as down
    from community_poll_votes v
    join community_polls pl on pl.post_id = v.post_id and pl.kind = 'outlook'
    join community_posts p on p.id = v.post_id and p.status = 'visible'
    where p.sgg_cd = ${sgg} and v.created_at > now() - interval '24 months'
    group by 1 order by 1`;
}

// ───────── 단지별 새 글 수(지도 배지) ─────────

export async function recentPostCounts(complexIds: number[], days = 7): Promise<Record<number, number>> {
  if (!complexIds.length) return {};
  const rows = await sql<{ complex_id: number; n: number }[]>`
    select complex_id, count(*)::int as n from community_posts
    where complex_id = any(${complexIds}) and status = 'visible' and created_at > now() - ${`${days} days`}::interval
    group by complex_id`;
  return Object.fromEntries(rows.map((r) => [r.complex_id, r.n]));
}

export async function getSummary(scope: "complex_faq" | "sgg_week", id: string) {
  const [r] = await sql<{ content_md: string; post_count: number; model: string | null; updated_at: string }[]>`
    select content_md, post_count, model, updated_at::text from community_summaries where scope = ${scope} and scope_id = ${id}`;
  return r ?? null;
}
