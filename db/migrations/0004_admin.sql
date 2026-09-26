-- 다중 사용자 운영: 공개 가입, 역할·상태, 기기 기억 세션, 사이트 설정, 관리자 감사 로그

-- 사용자 역할·상태
alter table users add column role   text not null default 'user' check (role in ('user', 'admin'));
alter table users add column status text not null default 'active' check (status in ('active', 'blocked'));
alter table users add column admin_note text;
alter table users add column blocked_at timestamptz;
create index users_created_idx on users (created_at desc);

-- 세션: "이 기기 기억하기", 마지막 접속
alter table sessions add column remember     boolean not null default true;  -- 기존 세션은 30일 쿠키였으므로 true
alter table sessions add column last_seen_at timestamptz;
alter table sessions add column ip           text;
create index sessions_active_idx on sessions (user_id, expires_at) where revoked_at is null;

-- IP 기준 로그인 코드 요청 제한용
create index otp_codes_ip_idx on otp_codes (ip, created_at desc);

-- AI 사용량을 사용자별로 집계(배치·ETL 호출은 null)
alter table ai_usage add column user_id uuid references users on delete set null;
create index ai_usage_user_idx on ai_usage (user_id, created_at desc);

-- 사이트 설정(관리 화면에서 변경). 값이 없으면 코드 기본값을 쓴다.
create table site_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users on delete set null
);

-- 관리자 작업 기록
create table admin_audit_log (
  id          bigserial primary key,
  admin_id    uuid references users on delete set null,
  admin_email text not null,
  action      text not null,
  target      text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index admin_audit_log_created_idx on admin_audit_log (created_at desc);
