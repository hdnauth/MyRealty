-- 입지 점수 검증: 단지 평당가(시점 보정, 시군구 고정효과 제거)를 항목별 점수로 회귀한 결과.
-- 점수가 가격과 얼마나 맞는지(설명력), 항목별 가격 효과, 데이터가 가리키는 가중치를 매일 기록한다.
create table if not exists location_calibrations (
  id           bigserial primary key,
  computed_at  timestamptz not null default now(),
  n            integer not null,              -- 회귀에 쓴 단지 수
  result       jsonb not null
);
create index if not exists location_calibrations_time_idx on location_calibrations (computed_at desc);
