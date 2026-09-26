-- Phase 2: AI 배치 추적, 알림 실행 상태, 조회 인덱스
create table ai_batches (
  id           bigserial primary key,
  purpose      text not null,              -- news_classify | ...
  batch_id     text not null unique,       -- Anthropic Message Batch ID
  status       text not null default 'in_progress',  -- in_progress | ended | applied | error
  request_ids  text[] not null default '{}',
  created_at   timestamptz not null default now(),
  applied_at   timestamptz
);

create index article_links_pending_idx on article_links (status) where status = 'pending';
create index articles_title_norm_idx on articles (title_norm, published_at desc);
create index transactions_collected_idx on transactions (collected_at);
create index transactions_updated_idx on transactions (updated_at) where is_canceled;
create index events_kind_idx on events (kind, starts_on);

alter table ai_usage add column batch boolean not null default false;
alter table ai_usage add column cost_usd numeric not null default 0;
