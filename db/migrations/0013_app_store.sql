-- 앱 마켓(Google Play) 심사 대응: 커뮤니티 사용자 차단, AI 생성 콘텐츠 신고

-- 차단: 차단한 사용자의 글은 목록에서 빠지고 댓글은 가려진다(상대에게 알리지 않음)
create table community_blocks (
  user_id    uuid not null references users on delete cascade,
  blocked_id uuid not null references users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);

-- AI 답변·리포트·요약 신고. 원문이 지워져도 검토할 수 있게 발췌를 함께 저장한다
create table ai_feedback (
  id          bigserial primary key,
  user_id     uuid references users on delete set null,
  surface     text not null check (surface in ('chat', 'report', 'community_summary', 'community_answer')),
  ref         text,                                            -- 대화 id·리포트 id·요약 scope:id·댓글 id
  excerpt     text not null,
  reason      text not null,                                   -- harmful|wrong|privacy|other
  detail      text,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users on delete set null
);
create index ai_feedback_open_idx on ai_feedback (status, created_at desc);
