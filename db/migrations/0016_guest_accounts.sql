-- 로그인 없이 쓰는 "기기 게스트" 계정: 이메일이 없는 사용자.
-- 처음 무언가를 저장할 때(관심 등록·구독·설정) 만들어지고, 그 기기의 세션 쿠키로 구분한다.
-- 이메일 간편 가입을 하면 같은 행에 이메일이 채워져 데이터가 그대로 이어진다.
alter table users alter column email drop not null;

-- 게스트 정리(오래 접속하지 않은 게스트)·통계용
create index if not exists users_guest_idx on users (created_at) where email is null;
