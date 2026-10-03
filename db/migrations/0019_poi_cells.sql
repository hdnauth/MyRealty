-- 주변 시설을 관심 부동산 지점뿐 아니라 '단지가 있는 0.01° 격자'(약 0.9×1.1km) 단위로도 모은다.
-- 격자 하나를 모두 받으면(공공 API 또는 OSM) 여기에 적고, 그 격자 안 단지는 입지 점수를 계산할 수 있다(시설이 충분히 잡힌 곳).
-- cx, cy = floor(경도 / 0.01), floor(위도 / 0.01). sources: 받은 원천(semas·hira·osm).
create table if not exists poi_cells (
  cx          int not null,
  cy          int not null,
  sources     text[] not null default '{}',
  fetched_at  timestamptz not null default now(),
  primary key (cx, cy)
);

-- 입지 점수가 어떤 시설 자료로 계산됐는지: full(격자·관심 부동산 주변 수집 완료) | quick(직주근접·지하철만, 화면에서 즉석 계산)
alter table location_scores add column if not exists basis text not null default 'full';
create index if not exists location_scores_computed_idx on location_scores (target_type, computed_at);
