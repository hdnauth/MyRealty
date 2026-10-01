-- 사용자별 AI 제공자·모델·키(본인 키). 키는 앱에서 AES-256-GCM 으로 암호화해 저장한다(AI_KEY_SECRET 또는 AUTH_SECRET 파생).
create table user_ai_settings (
  user_id     uuid primary key references users on delete cascade,
  provider    text not null check (provider in ('anthropic', 'openai', 'gemini', 'deepseek', 'mimo', 'ollama')),
  model       text not null,
  base_url    text,
  api_key_enc text,
  key_hint    text,             -- 화면 표시용 끝 4자리
  updated_at  timestamptz not null default now()
);

-- 사용 기록에 제공자·본인 키 여부(본인 키 사용분은 서버 예산·개인 한도에서 제외)
alter table ai_usage add column provider text not null default 'anthropic';
alter table ai_usage add column own_key boolean not null default false;
