-- 시설 영역(공원 등). 점(geom)만으로는 큰 공원 옆 단지가 '공원 중심까지 1km'로 계산되고 면적도 알 수 없었다.
-- shape 가 있으면 입지 점수는 경계까지 거리와 반경 안 면적(교차 면적)을 쓴다. geom 은 영역 안쪽 한 점(지도 표시용).
alter table pois add column if not exists shape geometry(MultiPolygon, 4326);
create index if not exists pois_shape_idx on pois using gist (shape);
