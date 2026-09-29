-- 필지 경계(브이월드 연속지적도 LP_PA_CBND_BUBUN). 토지·임야·단독 등의 필지 영역을 지도에 테두리로 그린다.
-- 웹이 처음 볼 때 받아 캐시한다(boundary_at: 마지막 조회 시각 — 못 찾은 경우도 기록해 반복 호출을 막는다).
alter table parcels add column if not exists boundary geometry(MultiPolygon, 4326);
alter table parcels add column if not exists boundary_at timestamptz;
create index if not exists parcels_boundary_idx on parcels using gist (boundary);
