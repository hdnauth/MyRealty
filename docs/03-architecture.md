# 03. 아키텍처 · 데이터 모델

## 1. 설계 원칙

- **1인 사용자 규모** → 운영 부담이 적은 매니지드 서비스(무료/저가 티어) 조합.
- **수집(ETL)과 서비스(Web) 분리** → 공공 API 호출은 배치로만, 웹은 자체 DB만 조회(빠르고 한도 걱정 없음).
- **계산은 코드, 해석은 AI** → 지표·시세는 결정적 코드로 계산해 저장, AI는 저장된 결과를 도구로 조회해 해석.

## 2. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 웹 프레임워크 | **Next.js (App Router) + TypeScript** | SSR/RSC, Route Handler로 BFF, Vercel 배포 용이 |
| UI | Tailwind CSS + shadcn/ui, 모바일 우선 반응형 | 빠른 구현, 다크모드 |
| 차트 | Apache ECharts (또는 Recharts) | 시계열·밴드·이중축·레이더 |
| 지도 | 네이버 Maps JS v3 + MarkerClustering | 요구사항 |
| 데이터 패칭 | TanStack Query | 캐시·재검증, 모바일 오프라인 친화 |
| PWA | Serwist(Workbox 기반) | 홈 화면 설치, 오프라인 캐시, Web Push |
| DB | **Supabase Postgres + PostGIS + pgvector** | 공간 쿼리(반경·폴리곤), 뉴스 임베딩 유사도, RLS |
| 인증 | **Supabase Auth — 이메일 OTP** | 간단한 이메일 인증 요구사항 충족, 공개 가입 차단 가능 |
| 스토리지 | Supabase Storage | 임장 사진 |
| ETL · 분석 | **Python** (uv, httpx, pandas, statsmodels/LightGBM) | 공공 API 파싱(XML/JSON), 통계·모델링 |
| 스케줄러 | GitHub Actions `schedule` (주), Supabase pg_cron (보조) | 무료, 로그·재실행 용이 |
| AI | Anthropic Claude API (TS SDK는 웹 Q&A, Python SDK는 배치) | 도구 사용, 구조화 출력, 배치, 프롬프트 캐싱 |
| 이메일 | Resend (또는 SMTP) — Supabase Auth 커스텀 SMTP로도 사용 | OTP·다이제스트 발송 |
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
                   │  Postgres + PostGIS + pgvector (RLS)     │
                   │  Auth (email OTP) · Storage · pg_cron    │
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

## 4. 인증 설계 (이메일 OTP)

1. 로그인 화면에서 이메일 입력 → `signInWithOtp({ email, options: { shouldCreateUser: false } })`
2. 메일 템플릿을 **6자리 코드(`{{ .Token }}`)** 형태로 설정 → 사용자가 앱에서 코드 입력 → `verifyOtp({ email, token, type: 'email' })`
3. **공개 가입 비활성화** + 본인 계정은 대시보드에서 초대/생성 → 허용 목록 외 이메일은 로그인 불가
4. `allowed_emails` 테이블을 두고 Auth Hook(가입 전 검사)으로 이중 차단(가족 추가 대비)
5. 세션은 `@supabase/ssr`로 쿠키 기반 관리, 미들웨어에서 보호 라우트 검사
6. OTP 요청 레이트 리밋(기본 제공) + 커스텀 SMTP로 발송 신뢰도 확보

> 매직링크 대신 코드 방식을 쓰는 이유: iOS에서 홈 화면에 설치한 PWA는 메일 앱의 링크가 Safari로 열려 PWA 세션에 로그인되지 않는 문제가 있음.

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
  is_canceled  boolean default false, canceled_at date,
  geom         geometry(Point, 4326),
  raw          jsonb,
  collected_at timestamptz default now()
);
create index on transactions (complex_id, deal_date);
create index on transactions using gist (geom);
create index on transactions (lawd_cd, property_type, deal_date);

-- 관심 물건
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

- **RLS**: `watch_items`, `notifications`, `ai_reports`, `notes`, `push_subscriptions`는 `user_id = auth.uid()` 정책. 공공 데이터 테이블은 인증 사용자 읽기 전용, 쓰기는 서비스 롤(ETL)만.
- 대출·임대 등 민감 정보는 RLS로 보호하고 백업 시 암호화.

## 6. ETL 파이프라인

| 잡 | 주기 | 내용 |
|---|---|---|
| `collect_rtms` | 매일 06:00 KST | 대상 시군구 × 최근 3개월 × 유형별 실거래 수집 → upsert(해제 반영) |
| `backfill_rtms` | 매일 02:00 | 남은 호출 한도로 과거 월 백필(최대 10년) |
| `geocode` | 수집 후 | 신규 지번/단지 좌표 지오코딩(캐시 우선) |
| `match_complex` | 수집 후 | 실거래 단지명·지번 ↔ `complexes` 매칭(정규화 + 별칭 + 지번) |
| `collect_attrs` | 물건 등록 시 + 월 1회 | 건축물대장·토지이용계획·토지특성·공시가격 |
| `collect_macro` | 매일(변경 시만 저장) | ECOS, KOSIS, R-ONE 지표 |
| `collect_events` | 매일 | 청약홈 분양정보, 온비드, 금통위·공시가격 일정 |
| `collect_news` | 하루 3회 | 물건/지역 키워드별 네이버 뉴스 → 중복 제거 → 신규분 AI 분류(Batch) |
| `compute_indicators` | 수집 후 | 조합 지표·온도계 재계산 → `series_values` |
| `compute_avm` | 매일 | 관심 물건 추정 시세 스냅샷 |
| `detect_alerts` | 매일 07:00 | 규칙 평가 → `notifications` → 즉시 푸시/다이제스트 메일 |
| `weekly_report` | 월 07:30 | AI 주간 브리핑 생성·발송 |

- 모든 잡은 **멱등(idempotent)** 하게: 원천 해시 기반 upsert, 재실행 안전.
- 호출 한도 관리: API별 일일 카운터 테이블(`api_quota`)로 잔여량 추적, 초과 시 다음 날로 이월.
- 물건 등록 직후에는 웹에서 "초기 수집" 잡을 트리거(GitHub `workflow_dispatch` 또는 Supabase Edge Function)해 해당 시군구 데이터를 먼저 채움.

## 7. 디렉터리 구조 (모노레포)

```
MyRealty/
├─ apps/
│  └─ web/                         # Next.js
│     ├─ app/
│     │  ├─ (auth)/login/
│     │  ├─ (main)/home/  map/  items/[id]/  items/new/  compare/
│     │  │           indicators/  ai/  calendar/  settings/
│     │  └─ api/ ai/chat/  push/  jobs/trigger/
│     ├─ components/  map/  charts/  cards/  ui/
│     ├─ lib/  supabase/  naver-map/  ai/tools/  format/
│     └─ public/  manifest.webmanifest  icons/
├─ services/
│  └─ etl/                         # Python
│     ├─ collectors/  molit_rtms.py  building_hub.py  kapt.py  vworld.py
│     │              reb_rone.py  ecos.py  kosis.py  applyhome.py  onbid.py  naver_news.py
│     ├─ transforms/  normalize.py  geocode.py  match_complex.py
│     ├─ analytics/   indicators.py  avm.py  similarity.py  temperature.py
│     ├─ ai/          news_classifier.py  weekly_report.py
│     ├─ alerts/      rules.py  notify.py
│     └─ jobs/        (잡 엔트리포인트)
├─ packages/
│  └─ shared/                      # 지표 정의(JSON), 공용 타입, 코드표
├─ supabase/
│  ├─ migrations/                  # 위 스키마 + RLS + RPC 함수
│  └─ seed/                        # 법정동코드, 행정경계
├─ .github/workflows/  etl-daily.yml  etl-news.yml  weekly-report.yml  ci.yml
└─ docs/
```

## 8. 반응형 · PWA 세부

- 브레이크포인트: `<640` 모바일(하단 탭), `640–1023` 태블릿, `≥1024` 데스크톱(사이드바 + 2단).
- 지도 화면: 모바일은 지도 전체 + 드래그 가능한 바텀시트 목록, PC는 좌측 목록/우측 지도.
- 오프라인: 최근 본 물건 상세·피드 캐시(Stale-While-Revalidate), 지도 타일은 캐시하지 않음(약관).
- Web Push: VAPID 키, iOS는 홈 화면 설치 후 권한 요청 가능 → 설정 화면에서 설치 안내.
