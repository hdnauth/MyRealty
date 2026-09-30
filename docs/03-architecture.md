# 03. 아키텍처 · 데이터 모델

## 1. 설계 원칙

- **1인 사용자 규모** → 운영 부담이 적은 매니지드 서비스(무료/저가 티어) 조합.
- **수집(ETL)과 서비스(Web) 분리** → 공공 API 호출은 배치로만, 웹은 자체 DB만 조회(빠르고 한도 걱정 없음).
- **계산은 코드, 해석은 AI** → 지표·시세는 결정적 코드로 계산해 저장, AI는 저장된 결과를 도구로 조회해 해석.

## 2. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 웹 프레임워크 | **Next.js (App Router) + TypeScript** | SSR/RSC, Route Handler로 BFF, Vercel 배포 용이 |
| UI | Tailwind CSS 4 + 자체 컴포넌트, 모바일 우선 반응형 | 다크모드(시스템 설정) |
| 차트 | Apache ECharts(단일 축 원칙, 검증된 3색 팔레트) | 시계열·산점도·막대 |
| 지도 | 네이버 Maps JS v3 + MarkerClustering | 요구사항 |
| 데이터 패칭 | React Server Components + Server Actions | 서버에서 DB 조회, 클라이언트 번들 최소화 |
| PWA | 앱 매니페스트 + 자체 서비스 워커(`public/sw.js`) | 홈 화면 설치, 오프라인 캐시, Web Push |
| DB | **Postgres + PostGIS + pgvector** (Supabase·Neon 등) | 공간 쿼리(반경·폴리곤), 뉴스 임베딩 확장 여지. 서버에서만 접근 |
| 인증 | **자체 구현 이메일 OTP** (6자리 코드 + JWT 세션 쿠키) | DB 종류에 묶이지 않고 로컬에서 그대로 테스트 가능, 허용 목록으로 공개 가입 차단 |
| 스토리지 | (향후) 오브젝트 스토리지 | 임장 사진 |
| ETL · 분석 | **Python** (uv, httpx, pandas, statsmodels/LightGBM) | 공공 API 파싱(XML/JSON), 통계·모델링 |
| 스케줄러 | GitHub Actions `schedule` (ETL 매일, 리포트 주/월) | 무료, 로그·재실행 용이 |
| AI | Anthropic Claude API (TS SDK는 웹 Q&A, Python SDK는 배치) | 도구 사용, 구조화 출력, 배치, 프롬프트 캐싱 |
| 이메일 | SMTP(Resend·Gmail 등) — 웹 nodemailer, ETL smtplib | OTP·다이제스트·리포트 발송 |
| 배포 | Vercel (웹), Supabase (DB), GitHub Actions (ETL) | |
| 모니터링 | Sentry(웹), ETL 실패 시 이메일 알림 | |

## 3. 시스템 구성

```
                   ┌───────────────────────────────────────────┐
                   │              GitHub Actions (cron)        │
                   │  Python ETL: collect → normalize → load   │
                   │  indicators → AVM → news AI → alerts      │
                   └──────┬──────────────────────┬─────────────┘
      공공 API / 뉴스 /    │ upsert                │ Claude Batch API
      지오코딩 ───────────▶│                       ▼
                   ┌──────▼──────────────────────────────────┐
                   │ Supabase                                 │
                   │  Postgres + PostGIS + pgvector           │
                   │  (Supabase·Neon·자체 서버 등)            │
                   └──────▲──────────────────────▲────────────┘
                          │ SQL/RPC (읽기 위주)   │
                   ┌──────┴──────────────────────┴────────────┐
                   │ Next.js on Vercel                        │
                   │  RSC 페이지 · Route Handlers(BFF)         │
                   │  /api/ai/chat  → Claude (tool use, stream)│
                   │  /api/push     → Web Push                 │
                   └──────▲───────────────────────────────────┘
                          │ HTTPS (PWA)
                   ┌──────┴──────┐        ┌──────────────┐
                   │ 모바일 / PC  │◀──────▶│ 네이버 Maps JS │
                   └─────────────┘        └──────────────┘
```

## 4. 인증 설계 (이메일 OTP) — 구현됨

1. 로그인 화면에서 이메일 입력 → 가입 정책 판단(`src/lib/auth/policy.ts` `decideLogin`)
   - 기존 사용자: 정지(`users.status='blocked'`)가 아니면 허용
   - 신규: `ADMIN_EMAILS` 는 항상 허용, 그 외는 관리 화면의 가입 방식(`site_settings.signupMode`: 누구나 / 허용 목록만 / 가입 중지)
2. 허용된 경우에만 6자리 코드를 생성해 **해시만** `otp_codes` 에 저장(10분 유효, 5회 시도 제한), SMTP 로 발송
   - 거부된 이메일에도 같은 응답을 돌려줘 계정 존재·정지 여부를 노출하지 않음
   - 요청 레이트리밋: 이메일당 1분 1회·1시간 5회, IP 당 1시간 30회
   - DB·메일·설정 오류는 원인별 문구 + 오류 번호로 보여주고 서버 로그에 같은 번호로 남김(`src/lib/errors.ts`)
3. 코드 확인(정책 재확인) → 사용자 생성/갱신 → `sessions` 행 생성 → HS256 JWT(`jti`=세션 ID, `rem`=기억 여부)를 httpOnly 쿠키로 발급
   - **이 기기 기억하기**: 90일 영구 쿠키, `src/proxy.ts` 가 하루 한 번 재발급하고 DB 만료도 연장 → 계속 쓰는 기기는 자동 로그인 유지
   - 기억하지 않기: 세션 쿠키(브라우저 종료 시 삭제) + 서버 세션 12시간
4. `src/proxy.ts`(Next 16 의 middleware 대체)가 서명만 빠르게 검사해 비로그인 요청을 `/login` 으로 보내고,
   각 페이지는 `requireUser()` 로 세션 폐기·만료·계정 정지를 DB 에서 재확인. `/admin` 은 `requireAdmin()`(아니면 404)
5. 관리자 = `ADMIN_EMAILS` 또는 `users.role='admin'`. 관리 화면에서 사용자 정지·관리자 지정·기기 로그아웃·삭제, 가입 방식·허용 목록·공지·1인당 AI 한도, 모든 작업은 `admin_audit_log` 에 기록
6. 설정 화면에서 기기별 로그아웃, 회원 탈퇴

> 매직링크 대신 코드 방식을 쓰는 이유: iOS에서 홈 화면에 설치한 PWA는 메일 앱의 링크가 Safari로 열려 PWA 세션에 로그인되지 않는 문제가 있음.
> 호스팅 DB 로 Supabase·Neon 등 어떤 Postgres 를 써도 되며, PostGIS·pgvector 확장만 필요하다.

## 5. 데이터 모델 (주요 테이블)

```sql
-- 지역/식별자
create table regions (
  lawd_cd      char(10) primary key,        -- 법정동코드
  sido, sigungu, eupmyeondong text,
  level        smallint,                    -- 1 시도, 2 시군구, 3 읍면동
  geom         geometry(MultiPolygon, 4326)
);

create table complexes (                    -- 아파트/오피스텔 단지
  id           bigserial primary key,
  kapt_code    text unique,
  name         text not null,
  property_type text not null,              -- apt | officetel
  lawd_cd      char(10) references regions,
  pnu          char(19),
  road_address text,
  households   int, buildings int,
  approved_at  date,                        -- 사용승인일
  geom         geometry(Point, 4326),
  name_aliases text[]                       -- 실거래 단지명 표기 차이 매칭용
);

create table parcels (                      -- 토지/임야/단독 필지
  pnu          char(19) primary key,
  lawd_cd      char(10),
  jimok        text,                        -- 대, 전, 답, 임야 ...
  area_m2      numeric,
  land_use_zone text[],                     -- 용도지역·지구
  road_side    text, terrain_shape text,
  geom         geometry(MultiPolygon, 4326),
  centroid     geometry(Point, 4326)
);

create table official_prices (              -- 공시가격/공시지가 이력
  target_type  text,                        -- apt_unit | house | land
  target_key   text,                        -- pnu 또는 pnu+동호
  year         smallint,
  price        bigint,
  primary key (target_type, target_key, year)
);

-- 거래
create table transactions (
  id           bigserial primary key,
  src_hash     text unique,                 -- 원천 레코드 해시(중복 방지 · upsert)
  property_type text not null,              -- apt|rowhouse|house|officetel|land|commercial|presale
  deal_kind    text not null,               -- sale|jeonse|wolse
  lawd_cd      char(10),
  jibun        text,                        -- 일부 유형은 마스킹 상태 그대로
  complex_id   bigint references complexes,
  pnu          char(19),
  jimok        text, land_use_zone text,    -- 토지 거래
  area_m2      numeric,                     -- 전용/연면적/거래면적
  land_area_m2 numeric,
  floor        smallint, build_year smallint,
  deal_date    date not null,
  price        bigint,                      -- 매매가(만원) 또는 보증금
  monthly_rent int,
  contract_term text, renewal_used boolean,
  is_direct    boolean,                     -- 직거래
  buyer_type text, seller_type text,         -- 매수자·매도자 구분(개인/법인/…), 0005
  registered_at date,                        -- 소유권 이전 등기일(신고 후 채워짐), 0005
  contract_type text, prev_deposit bigint, prev_rent int,  -- 전월세 신규/갱신·종전 계약, 0005
  is_canceled  boolean default false, canceled_at date,
  geom         geometry(Point, 4326),
  raw          jsonb,
  collected_at timestamptz default now()
);
create index on transactions (complex_id, deal_date);
create index on transactions using gist (geom);
create index on transactions (lawd_cd, property_type, deal_date);

-- 관심 부동산
create table watch_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  property_type text not null,
  label        text,
  group_tag    text,                        -- owned|candidate|watch|tenant
  pnu          char(19), complex_id bigint references complexes,
  dong_ho      text, area_m2 numeric, floor smallint,
  address      text, geom geometry(Point, 4326),
  purchase_price bigint, purchase_date date,
  loans        jsonb,                       -- [{amount, rate, type, maturity}]
  lease        jsonb,                       -- {deposit, rent, end_date}
  keywords     text[],                      -- 뉴스 매칭 키워드(자동 생성 + 수정)
  radius_m     int default 1000,
  alert_rules  jsonb,
  created_at   timestamptz default now()
);

-- 지표
create table series (                       -- 모든 시계열의 메타
  code         text primary key,            -- ecos.base_rate, reb.apt_idx.11710, custom.burden.11710 ...
  name         text, unit text, freq text,  -- D|W|M|Q|Y
  source       text, region_cd char(10),
  formula      text                         -- 조합/커스텀 지표 정의(파생 시계열만)
);
create table series_values (
  code         text references series,
  period       date,
  value        double precision,
  primary key (code, period)
);

create table valuations (                   -- AVM 결과 스냅샷
  watch_item_id uuid references watch_items,
  as_of        date,
  estimate     bigint, low bigint, high bigint,
  method       text, comps jsonb,
  primary key (watch_item_id, as_of)
);

-- 뉴스/정책/이벤트
create table articles (
  id           bigserial primary key,
  url          text unique, title text, summary text,
  source       text, published_at timestamptz,
  kind         text,                        -- news|press|policy
  embedding    vector(1024)
);
create table article_links (
  article_id   bigint references articles,
  watch_item_id uuid references watch_items,
  region_cd    char(10),
  relevance    real, category text,         -- 재건축|교통|규제|대출|공급|학군|기타
  impact       smallint,                    -- -2..+2
  ai_summary   text,
  primary key (article_id, watch_item_id)
);
create table events (
  id           bigserial primary key,
  kind         text,                        -- subscription|rate_decision|official_price|move_in|regulation|development|auction
  title        text, starts_on date, ends_on date,
  region_cd    char(10), geom geometry(Geometry, 4326),
  payload      jsonb, source_url text
);

-- 알림/AI
create table notifications (
  id           bigserial primary key,
  user_id      uuid references auth.users,
  watch_item_id uuid, kind text, title text, body text,
  payload      jsonb, priority smallint,
  created_at   timestamptz default now(),
  read_at      timestamptz, emailed_at timestamptz, pushed_at timestamptz
);
create table ai_reports (
  id           bigserial primary key,
  user_id      uuid references auth.users,
  scope        text,                        -- weekly|monthly|item|compare
  target_ids   uuid[], content_md text,
  model        text, usage jsonb,
  created_at   timestamptz default now()
);
create table notes (id uuid primary key, watch_item_id uuid, body text, photo_paths text[], created_at timestamptz);
create table allowed_emails (email text primary key);
create table push_subscriptions (user_id uuid, endpoint text primary key, keys jsonb);
```

- **접근 제어(구현)**: DB 는 서버(Next.js 서버 컴포넌트·Route Handler·Server Action, ETL)에서만 접근한다. 사용자 데이터(`watch_items`, `notifications`, `ai_reports`, `notes`, `push_subscriptions`, `ai_conversations`)는 모든 쿼리에 `user_id` 조건을 걸고, AI 도구도 로그인 사용자 범위로만 조회한다.
- 대출·임대 등 민감 정보는 사용자별로 격리(`user_id`)하고 백업 시 암호화한다. 모든 사용자가 함께 보는 개발사업(정비구역·철도) 데이터는 관리자만 등록·삭제한다.

## 6. ETL 파이프라인

| 잡 | 주기 | 내용 |
|---|---|---|
| `collect_rtms` | 매일 06:00 KST | 대상 시군구 × 최근 3개월 × 유형별 실거래 수집 → upsert(해제 반영) |
| `backfill_rtms` | 매일 02:00 | 남은 호출 한도로 과거 월 백필(최대 10년) |
| `geocode` | 수집 후 | 신규 지번/단지 좌표 지오코딩(캐시 우선) |
| `match_complex` | 수집 후 | 실거래 단지명·지번 ↔ `complexes` 매칭(정규화 + 별칭 + 지번) |
| `collect_attrs` | 부동산 등록 시 + 월 1회 | 건축물대장·토지이용계획·토지특성·공시가격 |
| `collect_macro` | 매일(변경 시만 저장) | ECOS, KOSIS, R-ONE 지표 |
| `collect_events` | 매일 | 청약홈 분양정보, 온비드, 금통위·공시가격 일정 |
| `collect_news` | 하루 3회 | 부동산/지역 키워드별 네이버 뉴스 → 중복 제거 → 신규분 AI 분류(Batch) |
| `compute_indicators` | 수집 후 | 조합 지표·온도계 재계산 → `series_values` |
| `compute_avm` | 매일 | 관심 부동산 추정 시세 스냅샷 |
| `detect_alerts` | 매일 07:00 | 규칙 평가 → `notifications` → 즉시 푸시/다이제스트 메일 |
| `weekly_report` | 월 07:30 | AI 주간 브리핑 생성·발송 |

- 모든 잡은 **멱등(idempotent)** 하게: 원천 해시 기반 upsert, 재실행 안전.
- 호출 한도 관리: API별 일일 카운터 테이블(`api_quota`)로 잔여량 추적, 초과 시 다음 날로 이월.
- 부동산 등록 시 해당 시군구가 `collect_targets` 에 추가되어 다음 daily 실행부터 수집된다. 급하면 GitHub Actions 의 `workflow_dispatch`(only: rtms backfill geocode link …)로 즉시 실행.

## 7. 디렉터리 구조 (구현)

```
MyRealty/
├─ apps/web/                        # Next.js 16
│  └─ src/
│     ├─ proxy.ts                   # 비로그인 → /login (Next 16 middleware 대체)
│     ├─ app/(auth)/login/          # 이메일 OTP
│     ├─ app/(main)/                # 홈·지도·관심 부동산(탭: 개요/시세/주변/입지/소식/분석/메모)·지표(+커스텀)
│     │                             # ·AI(질문/리포트)·비교·포트폴리오·캘린더·개발사업·알림·설정
│     ├─ app/api/                   # address, complexes, map/*, push, ai/chat(SSE), cron/reports
│     ├─ components/                # ui, shell, charts(ECharts), map(Naver), items, feed, indicators, ai
│     └─ lib/                       # db, auth, queries/*, ai/*(client·tools·prompts·analysis·compare·reports),
│                                   # finance, tax, expr(커스텀 지표 파서), format, property
├─ services/etl/src/myrealty_etl/
│  ├─ collectors/                   # rtms, building, vworld, naver_news, applyhome, macro, pois, projects
│  ├─ transforms/                   # complexes(단지 매칭·부동산 연결), geocode
│  ├─ analytics/                    # indicators(자체 지수·온도계), location(생활편의)·location_calibration(점수 검증), avm
│  ├─ ai/                           # client(사용량·예산), news_classifier(Batch/동기)
│  ├─ alerts/                       # rules(알림 규칙), notify(웹푸시·다이제스트)
│  ├─ jobs/                         # rtms_job, attrs_job, news_job, events_job, pois_job
│  ├─ series_catalog.py             # ECOS·KOSIS·R-ONE 코드
│  ├─ demo.py                       # 합성 데모 데이터
│  └─ cli.py                        # myrealty <명령>
├─ db/migrations/                   # 0001 초기, 0002 AI 배치·인덱스, 0003 POI·정비사업·인프라·입지 점수, … 0009 입지 점수 검증
└─ .github/workflows/               # ci.yml, etl-daily.yml, reports.yml
```

## 8. 반응형 · PWA 세부

- 브레이크포인트: `<640` 모바일(하단 탭), `640–1023` 태블릿, `≥1024` 데스크톱(사이드바 + 2단).
- 지도 화면: 모바일은 지도 전체 + 드래그 가능한 바텀시트 목록, PC는 좌측 목록/우측 지도.
- 오프라인: 최근 본 부동산 상세·피드 캐시(Stale-While-Revalidate), 지도 타일은 캐시하지 않음(약관).
- Web Push: VAPID 키, iOS는 홈 화면 설치 후 권한 요청 가능 → 설정 화면에서 설치 안내.
