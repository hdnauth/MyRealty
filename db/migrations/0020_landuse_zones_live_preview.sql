-- 토지이용계획 필지로 정비구역 경계·정비사업 후보지 찾기, 수집 전 지역 실거래 미리보기 캐시, 같은 시 다른 구 자동 수집 표시.

-- 브이월드 토지이용계획 WFS(getLandUseWFS) 필지 중 정비 관련 지정이 붙은 것만 남긴다.
-- code: zone(정비구역 UDT100) · candidate(정비구역기타 UDT999 — 정비사업 후보지 행위제한·건축행위 제한) · small(소규모주택정비 사업시행구역 UDK300)
-- tile: 받은 격자(0.004°) 'x:y' — 격자를 다시 받으면 그 격자 필지를 바꾼다
create table if not exists zone_parcels (
  pnu         char(19) not null,
  code        text not null,
  label       text,
  jibun       text,                        -- '499-10', 산이면 '산 12'
  tile        text not null,
  geom        geometry(MultiPolygon, 4326) not null,
  updated_at  timestamptz not null default now(),
  primary key (pnu, code)
);
create index if not exists zone_parcels_geom_idx on zone_parcels using gist (geom);
create index if not exists zone_parcels_tile_idx on zone_parcels (tile);

-- 필지를 이어 붙인 덩어리(매 실행 다시 계산). 구역 점에 경계를 붙이고, 이름 없는 후보지를 만드는 데 쓴다
create table if not exists zone_shapes (
  id          bigserial primary key,
  code        text not null,
  sgg_cd      char(5) not null,
  parcels     int not null,
  area_m2     numeric not null,
  rep_pnu     char(19) not null,
  geom        geometry(MultiPolygon, 4326) not null
);
create index if not exists zone_shapes_geom_idx on zone_shapes using gist (geom);

-- 수집 전 시군구의 실거래(공공데이터포털)를 지도 미리보기로 보여 줄 때 받은 결과(서비스·월 단위, 하루 동안 여러 사용자가 같이 쓴다)
create table if not exists live_trade_cache (
  sgg_cd      char(5) not null,
  svc         text not null,
  ym          char(6) not null,
  rows        jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (sgg_cd, svc, ym)
);

-- 미리보기 단지 위치(실거래에는 좌표가 없어 지번으로 찾는다). 한 번 찾으면 계속 쓴다. 못 찾으면 geom 없이 30일 기억
create table if not exists live_complex_geo (
  key         text primary key,
  sgg_cd      char(5) not null,
  umd_nm      text,
  jibun       text,
  name        text,
  geom        geometry(Point, 4326),
  tried_at    timestamptz not null default now()
);
create index if not exists live_complex_geo_sgg_idx on live_complex_geo (sgg_cd, umd_nm);

-- 같은 시의 다른 구를 자동으로 켰을 때 계기가 된 시군구(관리 화면 표시·끄기 판단용)
alter table collect_targets add column if not exists auto_from char(5);
