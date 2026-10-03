-- 지도에서 "이 지역 데이터 모으기" 요청: 아직 수집하지 않는 시군구를 방문자(기기 게스트 포함)가 요청한다.
-- 수집 대상(collect_targets)이 상한 미만이면 바로 켜고(enabled), 넘으면 대기(pending)로 남겨 운영자가 켠다.
create table if not exists region_requests (
  id          bigserial primary key,
  user_id     uuid not null references users(id) on delete cascade,
  sgg_cd      char(5) not null,
  name        text,
  status      text not null default 'enabled' check (status in ('enabled', 'pending')),
  created_at  timestamptz not null default now()
);
create index if not exists region_requests_user_idx on region_requests (user_id, created_at desc);
create index if not exists region_requests_sgg_idx on region_requests (sgg_cd);
