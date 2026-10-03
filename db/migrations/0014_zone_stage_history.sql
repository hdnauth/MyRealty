-- 정비사업 단계 변경 이력: 서울 정비사업 정보몽땅 자동 수집이 단계가 바뀔 때마다 한 줄 남긴다.
-- 개발사업 화면의 "최근 단계 변화"와 관심 부동산 주변 단계 변화 알림에 쓴다.
create table zone_stage_history (
  id          bigserial primary key,
  zone_id     bigint not null references redevelopment_zones on delete cascade,
  stage       text,
  stage_order smallint,
  prev_stage  text,
  prev_order  smallint,
  changed_at  timestamptz not null default now()
);
create index zone_stage_history_zone_idx on zone_stage_history (zone_id, changed_at desc);
create index zone_stage_history_time_idx on zone_stage_history (changed_at desc);

create index redevelopment_sgg_idx on redevelopment_zones (sgg_cd);
