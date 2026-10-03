-- 관리 화면 이용 지표: 하루 단위 접속 기록(일·주·월 활성, 7일 재방문), 알림을 직접 눌러 연 시각(열람률),
-- 지역 요청 거절 상태.
create table if not exists user_active_days (
  user_id  uuid not null references users(id) on delete cascade,
  day      date not null,           -- 한국 시간 기준 날짜
  primary key (user_id, day)
);
create index if not exists user_active_days_day_idx on user_active_days (day);

-- 지금까지의 세션 마지막 접속일로 시작값을 채운다(이후는 접속마다 기록)
insert into user_active_days (user_id, day)
select distinct user_id, (last_seen_at at time zone 'Asia/Seoul')::date from sessions where last_seen_at is not null
on conflict do nothing;

-- read_at 은 "모두 읽음"·부동산 열기에서도 한꺼번에 찍힌다. opened_at 은 사용자가 그 알림을 직접 눌렀을 때만.
alter table notifications add column if not exists opened_at timestamptz;

alter table region_requests drop constraint if exists region_requests_status_check;
alter table region_requests add constraint region_requests_status_check check (status in ('enabled', 'pending', 'rejected'));
