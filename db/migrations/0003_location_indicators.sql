-- Phase 3: 생활편의(POI) · 정비사업 · 인프라 사업 · 입지 점수
create table pois (
  id           bigserial primary key,
  source       text not null,               -- semas(소상공인) | hira(심평원) | csv:<dataset> | manual
  source_id    text not null,
  category     text not null,               -- subway | bus | school | academy | hospital | clinic | mart | convenience | food | cafe | park | retail
  subcategory  text,                        -- 초등학교 / 종합병원 / 편의점 …
  name         text not null,
  geom         geometry(Point, 4326) not null,
  area_m2      numeric,                     -- 공원 면적 등
  attrs        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (source, source_id)
);
create index pois_geom_idx on pois using gist (geom);
create index pois_cat_idx on pois (category);
-- 반경 조회는 geography 로 한다
create index pois_geog_idx on pois using gist ((geom::geography));

create table redevelopment_zones (
  id              bigserial primary key,
  source_key      text not null unique,
  name            text not null,
  kind            text not null,            -- 재건축 | 재개발 | 리모델링 | 가로주택 | 소규모재건축 | 도시환경 | 기타
  stage           text,                     -- 기본계획 | 정비구역지정 | 추진위 | 조합설립 | 사업시행인가 | 관리처분인가 | 이주·철거 | 착공 | 준공
  stage_order     smallint,                 -- 1~9 (진행도)
  stage_date      date,
  households_now  int,
  households_plan int,
  area_m2         numeric,
  address         text,
  sgg_cd          char(5),
  geom            geometry(Geometry, 4326),
  attrs           jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);
create index redevelopment_geom_idx on redevelopment_zones using gist (geom);

create table infra_projects (
  id             bigserial primary key,
  source_key     text not null unique,
  kind           text not null,             -- rail | station | road | ic
  name           text not null,             -- 예) GTX-A 삼성역, 위례신사선
  line_name      text,
  status         text not null,             -- 계획 | 예타 | 설계 | 착공 | 개통예정 | 개통
  status_order   smallint,                  -- 1~6
  expected_open  date,
  geom           geometry(Geometry, 4326),
  attrs          jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);
create index infra_geom_idx on infra_projects using gist (geom);

create table location_scores (
  target_type  text not null,               -- item | complex
  target_id    text not null,
  total        real,                        -- 0~100 생활편의 점수
  scores       jsonb not null,              -- {transit: {score, nearest: {...}, counts: {...}}, ...}
  development  jsonb,                       -- 정비사업·인프라 요약
  computed_at  timestamptz not null default now(),
  primary key (target_type, target_id)
);

-- 반경 수집 이력(같은 지점 반복 호출 방지)
create table poi_fetches (
  key         text primary key,               -- source:lng3:lat3:radius
  fetched_at  timestamptz not null default now(),
  count       int
);
