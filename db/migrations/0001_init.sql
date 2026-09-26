-- MyRealty 초기 스키마
-- 요구 확장: PostGIS(공간), pgvector(뉴스 임베딩), pgcrypto(gen_random_uuid)
create extension if not exists postgis;
create extension if not exists vector;
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- 계정 · 인증 (이메일 OTP)
-- ─────────────────────────────────────────────────────────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  display_name  text,
  settings      jsonb not null default '{}'::jsonb,   -- 알림 채널, 다이제스트 시각 등
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table allowed_emails (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

create table otp_codes (
  id          bigserial primary key,
  email       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    smallint not null default 0,
  consumed_at timestamptz,
  ip          text,
  created_at  timestamptz not null default now()
);
create index otp_codes_email_idx on otp_codes (email, created_at desc);

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  user_agent  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index sessions_user_idx on sessions (user_id);

-- ─────────────────────────────────────────────────────────────
-- 지역 · 식별자
-- ─────────────────────────────────────────────────────────────
create table regions (
  lawd_cd  char(10) primary key,          -- 법정동코드
  sido     text,
  sigungu  text,
  emd      text,
  level    smallint not null,             -- 1 시도, 2 시군구, 3 읍면동
  center   geometry(Point, 4326),
  geom     geometry(MultiPolygon, 4326)
);
create index regions_sgg_idx on regions (substr(lawd_cd, 1, 5));

-- ETL 수집 대상 시군구 (관심 물건 등록 시 자동 추가 + 수동 추가)
create table collect_targets (
  sgg_cd          char(5) primary key,
  name            text,
  enabled         boolean not null default true,
  backfill_months smallint not null default 36,
  backfilled_to   date,                   -- 여기까지(과거 방향) 백필 완료
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 물건 속성
-- ─────────────────────────────────────────────────────────────
create table complexes (                  -- 아파트/오피스텔/연립다세대 단지·건물
  id             bigserial primary key,
  complex_key    text not null unique,    -- RTMS aptSeq 또는 유형|시군구|읍면동|지번|이름
  property_type  text not null,           -- apt | officetel | rowhouse
  name           text not null,
  name_norm      text not null,
  aliases        text[] not null default '{}',
  sgg_cd         char(5) not null,
  lawd_cd        char(10),
  umd_nm         text,
  jibun          text,
  pnu            char(19),
  road_address   text,
  households     int,
  build_year     smallint,
  geom           geometry(Point, 4326),
  updated_at     timestamptz not null default now()
);
create index complexes_sgg_idx on complexes (sgg_cd, property_type);
create index complexes_geom_idx on complexes using gist (geom);
create index complexes_pnu_idx on complexes (pnu);

create table parcels (                    -- 토지 특성(필지)
  pnu            char(19) primary key,
  lawd_cd        char(10),
  jimok          text,
  area_m2        numeric,
  land_use_zone  text[],
  road_side      text,
  terrain_shape  text,
  terrain_height text,
  land_uses      jsonb,                   -- 토지이용계획 원본(지역·지구·구역 목록)
  centroid       geometry(Point, 4326),
  updated_at     timestamptz not null default now()
);

create table building_registers (         -- 건축물대장 스냅샷
  pnu         char(19) primary key,
  titles      jsonb not null default '[]'::jsonb,  -- 표제부 목록
  recap       jsonb,                               -- 총괄표제부
  fetched_at  timestamptz not null default now()
);

create table official_prices (            -- 공시가격 / 개별공시지가 이력
  target_type text not null,              -- apt_unit | house | land
  target_key  text not null,              -- pnu 또는 pnu|동|호
  year        smallint not null,
  price       bigint not null,            -- 원 (토지는 ㎡당 원)
  area_m2     numeric,
  primary key (target_type, target_key, year)
);

create table geocode_cache (
  query       text primary key,
  lng         double precision,
  lat         double precision,
  provider    text,
  fetched_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 거래 (실거래가)
-- ─────────────────────────────────────────────────────────────
create table transactions (
  id             bigserial primary key,
  src_hash       text not null unique,    -- 원천 레코드 식별 해시(해제 여부 제외) → upsert
  property_type  text not null,           -- apt|officetel|rowhouse|house|land|commercial|presale
  deal_kind      text not null,           -- sale | jeonse | wolse
  sgg_cd         char(5) not null,
  lawd_cd        char(10),
  umd_nm         text,
  jibun          text,                    -- 유형에 따라 일부 마스킹된 상태 그대로
  complex_id     bigint references complexes on delete set null,
  name           text,                    -- 원천 단지/건물명
  house_type     text,                    -- 연립/다세대/단독/다가구 등
  jimok          text,
  land_use       text,
  area_m2        numeric,                 -- 전용 / 연면적 / 거래면적
  land_area_m2   numeric,
  floor          smallint,
  build_year     smallint,
  deal_date      date not null,
  price          bigint,                  -- 매매가 또는 보증금 (만원)
  monthly_rent   int,                     -- 만원
  contract_term  text,
  renewal_used   boolean,
  is_direct      boolean,
  is_canceled    boolean not null default false,
  canceled_at    date,
  geom           geometry(Point, 4326),
  raw            jsonb,
  collected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index tx_complex_idx on transactions (complex_id, deal_kind, deal_date);
create index tx_region_idx on transactions (sgg_cd, property_type, deal_kind, deal_date);
create index tx_geom_idx on transactions using gist (geom);
create index tx_deal_date_idx on transactions (deal_date);

-- ─────────────────────────────────────────────────────────────
-- 관심 물건
-- ─────────────────────────────────────────────────────────────
create table watch_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users on delete cascade,
  property_type   text not null,          -- apt|officetel|rowhouse|house|land|forest|commercial
  label           text not null,
  group_tag       text not null default 'watch',   -- owned|candidate|watch|tenant
  road_address    text,
  jibun_address   text,
  building_name   text,
  lawd_cd         char(10),
  sgg_cd          char(5),
  pnu             char(19),
  complex_id      bigint references complexes on delete set null,
  dong_ho         text,
  area_m2         numeric,
  land_area_m2    numeric,
  floor           smallint,
  geom            geometry(Point, 4326),
  purchase_price  bigint,                 -- 만원
  purchase_date   date,
  loans           jsonb not null default '[]'::jsonb,  -- [{name, amount(만원), rate(%), years, type, maturity}]
  lease           jsonb,                  -- {kind: jeonse|wolse, deposit, rent, end_date, role: landlord|tenant}
  keywords        text[] not null default '{}',
  radius_m        int not null default 1000,
  alert_rules     jsonb not null default '{}'::jsonb,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index watch_items_user_idx on watch_items (user_id);
create index watch_items_geom_idx on watch_items using gist (geom);

create table notes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users on delete cascade,
  watch_item_id  uuid not null references watch_items on delete cascade,
  body           text not null default '',
  photo_paths    text[] not null default '{}',
  checklist      jsonb,
  created_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 시계열 · 지표
-- ─────────────────────────────────────────────────────────────
create table series (
  code        text primary key,           -- ecos.base_rate / reb.apt_sale_idx.11710 / ind.burden.11710
  name        text not null,
  unit        text,
  freq        text not null,              -- D|W|M|Q|Y
  source      text not null,
  category    text not null default 'macro',  -- macro | region | indicator | custom
  region_cd   char(10),
  formula     text,
  description text,
  updated_at  timestamptz not null default now()
);
create table series_values (
  code    text not null references series on delete cascade,
  period  date not null,
  value   double precision not null,
  primary key (code, period)
);

create table custom_indicators (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  name        text not null,
  expression  text not null,
  created_at  timestamptz not null default now()
);

create table valuations (                 -- 추정 시세(AVM) 스냅샷
  watch_item_id uuid not null references watch_items on delete cascade,
  as_of         date not null,
  estimate      bigint,                   -- 만원
  low           bigint,
  high          bigint,
  method        text,
  confidence    text,                     -- high | medium | low
  comps         jsonb,
  primary key (watch_item_id, as_of)
);

-- ─────────────────────────────────────────────────────────────
-- 뉴스 · 정책 · 이벤트
-- ─────────────────────────────────────────────────────────────
create table articles (
  id            bigserial primary key,
  url           text not null unique,
  title         text not null,
  description   text,
  source        text,
  kind          text not null default 'news',  -- news | press | policy
  published_at  timestamptz,
  title_norm    text,
  embedding     vector(1024),
  fetched_at    timestamptz not null default now()
);
create index articles_published_idx on articles (published_at desc);

create table article_links (
  id             bigserial primary key,
  article_id     bigint not null references articles on delete cascade,
  watch_item_id  uuid references watch_items on delete cascade,
  sgg_cd         char(5),
  query          text,
  status         text not null default 'pending',   -- pending | classified | error
  relevance      real,
  category       text,
  impact         smallint,                          -- -2..+2
  ai_summary     text,
  classified_at  timestamptz,
  created_at     timestamptz not null default now()
);
create unique index article_links_uniq on article_links (article_id, coalesce(watch_item_id::text, ''), coalesce(sgg_cd, ''));
create index article_links_item_idx on article_links (watch_item_id, relevance desc);

create table events (
  id          bigserial primary key,
  source_key  text not null unique,
  kind        text not null,              -- subscription|rate_decision|official_price|move_in|regulation|development|auction|stat_release
  title       text not null,
  starts_on   date,
  ends_on     date,
  sgg_cd      char(5),
  lawd_cd     char(10),
  address     text,
  geom        geometry(Point, 4326),
  payload     jsonb not null default '{}'::jsonb,
  source_url  text,
  created_at  timestamptz not null default now()
);
create index events_date_idx on events (starts_on);
create index events_geom_idx on events using gist (geom);

-- ─────────────────────────────────────────────────────────────
-- 알림 · AI
-- ─────────────────────────────────────────────────────────────
create table notifications (
  id             bigserial primary key,
  user_id        uuid not null references users on delete cascade,
  watch_item_id  uuid references watch_items on delete cascade,
  kind           text not null,           -- new_trade|record_high|record_low|canceled|subscription|news|policy|indicator|rate|lease_expiry
  title          text not null,
  body           text,
  url            text,
  payload        jsonb not null default '{}'::jsonb,
  priority       smallint not null default 1,   -- 0 낮음, 1 보통, 2 중요(즉시 푸시)
  dedupe_key     text not null,
  created_at     timestamptz not null default now(),
  read_at        timestamptz,
  emailed_at     timestamptz,
  pushed_at      timestamptz,
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on notifications (user_id, created_at desc);

create table push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references users on delete cascade,
  keys        jsonb not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create table ai_reports (
  id          bigserial primary key,
  user_id     uuid not null references users on delete cascade,
  scope       text not null,              -- weekly | monthly | item | compare
  target_ids  uuid[] not null default '{}',
  title       text,
  content_md  text not null,
  data        jsonb,
  model       text,
  created_at  timestamptz not null default now()
);
create index ai_reports_user_idx on ai_reports (user_id, created_at desc);

create table ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table ai_messages (
  id               bigserial primary key,
  conversation_id  uuid not null references ai_conversations on delete cascade,
  role             text not null,         -- user | assistant
  content          jsonb not null,        -- Claude content blocks
  created_at       timestamptz not null default now()
);

create table ai_usage (
  id              bigserial primary key,
  purpose         text not null,
  model           text not null,
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  cache_read      int not null default 0,
  cache_write     int not null default 0,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 운영
-- ─────────────────────────────────────────────────────────────
create table api_quota (
  api    text not null,
  day    date not null,
  calls  int not null default 0,
  primary key (api, day)
);

create table job_runs (
  id           bigserial primary key,
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',  -- running | ok | error
  detail       jsonb
);
create index job_runs_job_idx on job_runs (job, started_at desc);
