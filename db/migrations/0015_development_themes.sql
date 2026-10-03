-- 개발·테마: 구역 경계, 규제 구역, 구역 팔로우, 구역 ↔ 단지 연결, 단계 변화 전후 가격 효과.

-- 서울시 의제처리구역(정비·재정비촉진 계열) 경계. 정보몽땅 사업장 점을 이 경계로 바꾼다.
create table zone_boundaries (
  present_sn  text primary key,
  wtnnc_sn    text,                        -- 결정고시 관리코드(정보몽땅 map_code 와 같음)
  name        text,
  atrb_se     text,
  sgg_cd      char(5),
  area_m2     numeric,
  geom        geometry(MultiPolygon, 4326),
  updated_at  timestamptz not null default now()
);
create index zone_boundaries_geom_idx on zone_boundaries using gist (geom);
create index zone_boundaries_code_idx on zone_boundaries (wtnnc_sn);

-- 규제·계획 구역(브이월드 용도구역 LT_C_UQ141): 토지거래허가구역(permit), 지구단위계획구역(district_plan)
create table regulation_areas (
  id          bigserial primary key,
  source_key  text not null unique,
  kind        text not null,
  name        text not null,
  sido        text,
  sgg_name    text,
  dyear       text,
  geom        geometry(MultiPolygon, 4326),
  attrs       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index regulation_areas_geom_idx on regulation_areas using gist (geom);
create index regulation_areas_kind_idx on regulation_areas (kind);

-- 구역 팔로우(관심 부동산 반경과 별개로 지켜보는 구역 → 단계 변화 알림)
create table zone_follows (
  user_id     uuid not null references users on delete cascade,
  zone_id     bigint not null references redevelopment_zones on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, zone_id)
);
create index zone_follows_zone_idx on zone_follows (zone_id);

-- 구역 ↔ 단지: 경계 안(inside) · 같은 이름(name) · 구역 점 가까이(near)
create table zone_complexes (
  zone_id     bigint not null references redevelopment_zones on delete cascade,
  complex_id  bigint not null references complexes on delete cascade,
  how         text not null,
  dist_m      int,
  primary key (zone_id, complex_id)
);
create index zone_complexes_complex_idx on zone_complexes (complex_id);

-- 단계 변화 전후 1년: 구역 단지 평당가 변화 vs 시군구 자체 지수 변화(이벤트 스터디).
-- 사건은 수집이 감지한 단계 변경(zone_stage_history) 또는 출처가 날짜를 준 현재 단계(예: 대전 "준공(2022-04-28)").
create table zone_stage_effects (
  id             bigserial primary key,
  zone_id        bigint not null references redevelopment_zones on delete cascade,
  history_id     bigint references zone_stage_history on delete cascade,
  stage          text,
  stage_order    smallint,
  changed_on     date not null,
  complex_change real,
  region_change  real,
  excess         real,
  n_before       int,
  n_after        int,
  computed_at    timestamptz not null default now(),
  unique (zone_id, stage_order, changed_on)
);
create index zone_stage_effects_zone_idx on zone_stage_effects (zone_id);

-- 출처 무관 필터(시도·출처)용
create index redevelopment_source_idx on redevelopment_zones ((split_part(source_key, ':', 1)));
create index redevelopment_sido_idx on redevelopment_zones ((attrs->>'sido'));
