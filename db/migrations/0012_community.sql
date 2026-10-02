-- 커뮤니티: 시군구·단지 게시판, 댓글, 좋아요, 신고, 투표, 구독, 이미지, 거주 인증, 단지 FAQ
-- 단지 글도 항상 sgg_cd 를 채워 시군구 피드에 함께 모인다(빈 게시판 완화).

create extension if not exists pg_trgm;

-- 닉네임(앱 전체 공통, 대소문자 무시 고유) · 운영 원칙 동의 · 작성 제한 · 활동 점수
alter table users add column nickname text;
alter table users add column community_agreed_at timestamptz;
alter table users add column community_muted_until timestamptz;
alter table users add column community_points int not null default 0;
create unique index users_nickname_key on users (lower(nickname));

create table community_posts (
  id               bigserial primary key,
  user_id          uuid references users on delete set null,   -- 탈퇴해도 글은 남고 "탈퇴한 사용자"로 보인다
  sgg_cd           char(5) not null,
  complex_id       bigint references complexes on delete set null,
  category         text not null,                              -- question|info|opinion|review|life|data
  kind             text not null default 'user' check (kind in ('user', 'system')),
  title            text not null,
  body             text not null default '',
  attachments      jsonb not null default '[]'::jsonb,         -- [{type:'trade',id} | {type:'complex',id} | {type:'series',code} | {type:'image',id}]
  status           text not null default 'visible' check (status in ('visible', 'held', 'hidden', 'deleted')),
  moderation       jsonb not null default '{}'::jsonb,         -- {flags:[...], ai:{verdict, reason}, by, at}
  like_count       int not null default 0,
  comment_count    int not null default 0,
  report_count     int not null default 0,
  view_count       int not null default 0,
  source_key       text unique,                                -- 시스템 글 중복 방지(record_high:<tx id> 등)
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  edited_at        timestamptz
);
create index community_posts_sgg_idx on community_posts (sgg_cd, created_at desc) where status = 'visible';
create index community_posts_complex_idx on community_posts (complex_id, created_at desc) where status = 'visible';
create index community_posts_user_idx on community_posts (user_id, created_at desc);
create index community_posts_review_idx on community_posts (status, created_at desc) where status in ('held', 'hidden');
create index community_posts_search_idx on community_posts using gin ((title || ' ' || body) gin_trgm_ops);

create table community_comments (
  id           bigserial primary key,
  post_id      bigint not null references community_posts on delete cascade,
  parent_id    bigint references community_comments on delete cascade,  -- 대댓글은 1단계까지
  user_id      uuid references users on delete set null,
  kind         text not null default 'user' check (kind in ('user', 'ai')),
  body         text not null,
  status       text not null default 'visible' check (status in ('visible', 'held', 'hidden', 'deleted')),
  moderation   jsonb not null default '{}'::jsonb,
  like_count   int not null default 0,
  report_count int not null default 0,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz
);
create index community_comments_post_idx on community_comments (post_id, created_at);
create index community_comments_user_idx on community_comments (user_id, created_at desc);
create index community_comments_review_idx on community_comments (status, created_at desc) where status in ('held', 'hidden');

create table community_reactions (
  target_type text not null check (target_type in ('post', 'comment')),
  target_id   bigint not null,
  user_id     uuid not null references users on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (target_type, target_id, user_id)
);

create table community_reports (
  id          bigserial primary key,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id   bigint not null,
  reporter_id uuid references users on delete set null,
  reason      text not null,                                   -- collusion|ad|abuse|privacy|false|other
  detail      text,
  status      text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users on delete set null,
  unique (target_type, target_id, reporter_id)
);
create index community_reports_open_idx on community_reports (status, created_at desc);

create table community_polls (
  post_id   bigint primary key references community_posts on delete cascade,
  kind      text not null default 'custom' check (kind in ('custom', 'outlook')),  -- outlook: 1년 뒤 가격 전망(심리 지표 집계)
  question  text not null,
  options   text[] not null,
  closes_at timestamptz
);
create table community_poll_votes (
  post_id    bigint not null references community_polls on delete cascade,
  user_id    uuid not null references users on delete cascade,
  option     smallint not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- 관심 부동산의 단지·시군구는 자동 구독. 여기는 그 밖에 직접 구독한 곳
create table community_follows (
  user_id    uuid not null references users on delete cascade,
  scope      text not null check (scope in ('sgg', 'complex')),
  scope_id   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, scope, scope_id)
);

-- 첨부 이미지(브라우저에서 줄여 올린 JPEG/WebP). 규모가 커지면 오브젝트 스토리지로 옮긴다
create table community_images (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users on delete cascade,
  post_id    bigint references community_posts on delete cascade,  -- 글 저장 전에는 null(하루 지나면 정리)
  mime       text not null,
  width      int,
  height     int,
  bytes      int not null,
  data       bytea not null,
  created_at timestamptz not null default now()
);
create index community_images_user_idx on community_images (user_id, created_at desc);
create index community_images_orphan_idx on community_images (created_at) where post_id is null;

-- 거주 인증: 단지 근처에서 서로 다른 날 위치 확인을 여러 번 하면 인증(좌표는 저장하지 않고 거리만)
create table community_residences (
  user_id     uuid not null references users on delete cascade,
  complex_id  bigint not null references complexes on delete cascade,
  checks      jsonb not null default '[]'::jsonb,               -- [{day:'2026-10-02', dist:42}]
  verified_at timestamptz,
  expires_at  timestamptz,
  primary key (user_id, complex_id)
);

-- 단지 FAQ(이야기 글을 AI 가 모아 정리) · 시군구 주간 요약 캐시
create table community_summaries (
  scope        text not null check (scope in ('complex_faq', 'sgg_week')),
  scope_id     text not null,
  content_md   text not null,
  post_count   int not null,
  model        text,
  generated_by uuid references users on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (scope, scope_id)
);
