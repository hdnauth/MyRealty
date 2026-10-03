# 06. 배포 · 운영 가이드

구성: **Postgres(PostGIS·pgvector)** + **Next.js 웹(Vercel 등)** + **Python ETL(GitHub Actions 스케줄)**.
모든 비밀값은 리포지토리 루트 `.env`(로컬) 또는 각 플랫폼의 환경 변수·시크릿으로 넣는다(`.env.example` 참고).

## 1. 키 발급 (한 번)

[02 문서의 발급 체크리스트](02-data-sources.md#8-발급-체크리스트) 순서대로 발급한다. 가장 오래 걸리는 것은 공공데이터포털 활용신청이다.

| 환경 변수 | 용도 | 없을 때 |
|---|---|---|
| `DATA_GO_KR_KEY` | 실거래가 11종, 건축물대장, 청약홈, 상가정보, 병원정보. **웹에도 넣으면** 부동산 등록 시 건축물대장으로 유형·평형·동·호·면적 자동 입력 | 실거래·속성·청약·POI 수집 건너뜀, 등록 화면은 수집된 실거래 면적만 제시 |
| `JUSO_KEY` | 부동산 등록 시 주소 검색 | 수집된 단지명 검색만 가능 |
| `NCP_MAPS_KEY_ID` / `NCP_MAPS_KEY` | 네이버 지도 표시, 지오코딩 | 대체 지도(브이월드 배경 → OpenStreetMap)로 표시, 좌표는 VWorld 로 보조 |
| `VWORLD_KEY` (+`VWORLD_DOMAIN`) | 토지특성·이용계획·공시가격, 지오코딩 보조, 대체 지도 배경. **웹에도 넣으면** 토지·임야 등록 시 지목·면적 자동 입력 | 토지·공시가격 없음 |
| `ECOS_KEY`, `KOSIS_KEY`, `REB_KEY` | 금리·물가·M2, 미분양, 부동산원 지수 | 자체 지수·지표는 계산되나 금리·물가 보정 없음 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 뉴스 검색(NAVER API HUB 또는 개발자센터 키 — 형식으로 자동 판별) | 뉴스 수집 건너뜀 |
| `ANTHROPIC_API_KEY` | 뉴스 분류, AI 질문·분석·비교·리포트 | AI 기능 비활성 |
| `SMTP_*`, `MAIL_FROM` | 로그인 코드, 다이제스트, 리포트 메일 | 로그인 코드가 서버 로그에 출력(개발용) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 웹푸시 (`npx web-push generate-vapid-keys`) | 푸시 없이 메일만 |
| `AUTH_SECRET` | 세션 서명 (`openssl rand -base64 32`) | **필수** |
| `ADMIN_EMAILS` | 관리자 계정(쉼표 구분) — 관리 화면 `/admin` | 관리 화면 없음(DB 에서 `users.role='admin'` 지정 가능) |
| `ALLOWED_EMAILS` | 가입 방식이 "허용 목록만"일 때 추가 허용 | 기본(누구나 가입)에서는 불필요 |
| `CRON_SECRET` | 정기 리포트 엔드포인트 보호 | 리포트 스케줄 불가(수동 생성은 가능) |

## 2. 데이터베이스

### Supabase (권장, 무료로 시작)
1. 프로젝트 생성 → Database → Extensions 에서 `postgis`, `vector`, `pgcrypto` 활성화
2. 연결 문자열
   - ETL(GitHub Actions): **Session/Direct** 연결 문자열 → `DATABASE_URL`
   - 웹(Vercel): **Session pooler**(pooler 호스트의 5432) 문자열 권장 — prepared statement 가 돼 쿼리당 DB 왕복이 1회.
     접속 수 한도 오류(`max clients reached`)가 나면 **Transaction pooler**(6543)로 바꾼다(자동으로 prepare 를 꺼 쿼리당 왕복 2회, 아래 8. 속도 참고)
   - 프로젝트를 만들 때 지역은 **Northeast Asia (Seoul)** 를 고른다(웹 함수 지역 `icn1` 과 맞춤, 나중에 바꿀 수 없음)
3. 스키마 적용: `cd services/etl && DATABASE_URL=... uv run myrealty migrate`

Neon·RDS·자체 Postgres 도 PostGIS·pgvector 만 있으면 된다. 인증을 앱이 직접 처리하므로 Supabase Auth·RLS 는 쓰지 않으며, DB 는 서버에서만 접근한다(브라우저에 DB 키를 노출하지 않음).

### 초기 설정
기본 가입 방식은 **누구나 가입**이다. `.env` 의 `ADMIN_EMAILS` 에 내 이메일을 넣고 로그인하면 관리 화면(`/admin`)에서
가입 방식(누구나 / 허용 목록만 / 가입 중지)·공지·1인당 AI 한도를 바꾸고 사용자를 관리할 수 있다.
```bash
uv run myrealty allow-email friend@example.com    # (가입 방식이 "허용 목록만"일 때) 허용 목록 추가 — 관리 화면에서도 가능
# (선택) 표준데이터 CSV 로 생활편의 POI 채우기 — 공공데이터포털에서 파일 다운로드
uv run myrealty import-poi 전국도시철도역사정보표준데이터.csv --category subway
uv run myrealty import-poi 전국초중등학교위치표준데이터.csv --category school
uv run myrealty import-poi 전국도시공원정보표준데이터.csv --category park
uv run myrealty import-poi 전국버스정류장위치정보.csv --category bus
uv run myrealty import-poi 대규모점포.csv --category mart --srid 5174   # LOCALDATA TM 좌표
# (선택) 정비사업·철도 사업 GeoJSON
uv run myrealty import-geo zones.geojson --kind zones
uv run myrealty import-geo rail.geojson --kind infra
```

## 3. 웹 배포 (Vercel 기준)

1. 새 프로젝트 → 이 저장소, **Root Directory = `apps/web`**, Framework = Next.js
2. Environment Variables: `DATABASE_URL`(Session pooler 권장), `DATABASE_PREPARE`(보통 비워 둠 — 6543 트랜잭션 풀러 주소면 자동으로 끔), `AUTH_SECRET`, `ADMIN_EMAILS`, `APP_URL`,
   `JUSO_KEY`, `NCP_MAPS_KEY_ID`, `NCP_MAPS_KEY`, `DATA_GO_KR_KEY`, `VWORLD_KEY`(+`VWORLD_DOMAIN`), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_MONTHLY_BUDGET_USD`,
   `SMTP_*`, `MAIL_FROM`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`,
   (선택) `GITHUB_DISPATCH_TOKEN`·`GITHUB_DISPATCH_REPO` — 등록 직후 개별 수집(아래 4. 스케줄의 `etl-item.yml`)
3. 함수 지역은 `apps/web/vercel.json` 의 `regions`(기본 `icn1` 서울)로 정해진다. **DB 와 같은 지역**이어야 빠르다(8. 속도).
4. 네이버 클라우드 Maps 애플리케이션에서 **Dynamic Map**(지도)·**Geocoding** 을 선택하고, **Web 서비스 URL** 에 배포 도메인(과 `http://localhost:3000`) 등록.
   인증에 실패하면 지도 화면 위에 원인과 등록할 주소가 표시되고 대체 지도로 보인다.
5. 휴대폰에서 접속 → (iPhone) Safari 공유 → 홈 화면에 추가 → 앱에서 설정 → "이 기기에서 푸시 받기"

> 다른 호스팅(자체 서버 `pnpm build && pnpm start`, Docker 등)도 동일한 환경 변수로 동작한다. 자체 서버에서는 리포지토리 루트 `.env` 를
> 자동으로 읽는다(플랫폼·셸에서 설정한 값이 우선).
6. 배포 후 `https://<도메인>/api/health` 가 `{"ok":true,...}` 인지 확인한다. `db`·`pendingMigrations`·`authSecret` 으로 원인을 바로 알 수 있다.

## 4. 스케줄 (GitHub Actions)

| 워크플로 | 시각(KST) | 내용 |
|---|---|---|
| `etl-daily.yml` | 매일 05:50 | `myrealty daily --stage collect`(수집·분석, 45분 제한) → `--stage notify`(알림·발송·정리, 수집이 실패·시간 초과여도 실행) |
| `reports.yml` | 월 07:40 / 매월 1일 07:50 | `GET /api/cron/reports?kind=weekly|monthly` |
| `ci.yml` | push·PR | 웹 lint·typecheck·test·build, ETL ruff·pytest(PostGIS) |
| `migrate.yml` | main 에 `db/migrations/**` 변경이 들어올 때 · 수동 | `myrealty migrate` — 운영 DB 스키마를 배포와 함께 맞춘다(매일 ETL 도 시작 전에 한 번 더 확인) |
| `etl-item.yml` | 웹이 호출(부동산 등록 직후 · 빈 데이터가 있는 부동산을 열 때) · 수동 | `myrealty item --item <id>` — 그 부동산 하나만 바로 수집(보통 2~5분) |

GitHub → Settings → Secrets and variables → Actions 에 `.env` 항목을 **Secrets** 로, `APP_URL`·`ANTHROPIC_MODEL`·`ANTHROPIC_BULK_MODEL` 은 **Variables** 로 넣는다. 수동 실행: Actions → ETL daily → Run workflow (`only` 에 `rtms news` 처럼 단계 지정 가능). 마이그레이션만 따로: Actions → DB migrate → Run workflow.

### daily 단계
| 단계 | 하는 일 | 필요 키 |
|---|---|---|
| `rtms` | 수집 대상 시군구 × 최근 3개월 × 11종 실거래 재수집(해제 반영) | DATA_GO_KR |
| `geocode` | 단지·읍면동 좌표, 거래 좌표 전파 | NCP 또는 VWORLD |
| `link` | 관심 부동산 ↔ 단지 자동 연결 | - |
| `macro` | ECOS·KOSIS·R-ONE 시계열 | 각 키 |
| `attrs` | 건축물대장·토지특성·이용계획·공시가격(월 1회 갱신) | DATA_GO_KR, VWORLD |
| `events` | 청약·입주 예정, 공시·세금 일정 | DATA_GO_KR |
| `news` / `classify` | 키워드 뉴스 수집 → Claude 분류(소량 동기, 대량 Batch) | NAVER, ANTHROPIC |
| `indicators` | 자체 지수·조합 지표·온도계, 금리 변경·온도 구간 알림 | - |
| `pois` | 주변 편의시설 수집(관심 부동산 주변 + 수집 지역 단지 격자, 하루 30칸) → 생활편의 점수(시설이 갖춰진 모든 단지) | DATA_GO_KR(없으면 OSM·CSV 로) |
| `location_check` | 입지 점수 검증(단지 평당가 회귀 → 설명력·항목별 효과·권장 가중, AVM 입지 보정 계수) — `myrealty location-check` | - |
| `avm` | 추정 시세 | - |
| `backfill` | 과거 월 백필(시군구당 기본 36개월, 실행당 최대 6개월). 지역을 한 달씩 번갈아 수집하고, 시간 예산이 끝나면 멈췄다가 다음 실행에서 이어서 | DATA_GO_KR |
| `alerts` / `push` / `digest` | 알림 규칙 → 웹푸시(중요) / 이메일 다이제스트 | VAPID / SMTP |

각 단계는 키가 없으면 `skipped` 로 넘어가고, 실패해도 다음 단계를 계속한다. 수집 단계는 `DAILY_BUDGET_MIN`(Actions Variables, 기본 38분)이 지나면 남은 단계를 다음 실행으로 넘긴다 — `backfill` 은 남는 시간만 쓰도록 수집 단계 맨 끝에 있다. `alerts`·`push`·`digest`·`cleanup` 은 예산과 상관없이 항상 실행된다. 실행 기록은 `job_runs` 테이블과 설정 화면 "데이터 수집(ETL) 최근 실행"에서 본다.

### 개별 수집 (등록 직후 바로 채우기)

매일 수집만 있으면 새로 등록한 부동산은 다음 날 아침까지 대부분 비어 있다. 웹에 아래 두 값을 넣으면 등록 직후(그리고 핵심 데이터가 빈 부동산을 열 때, 12시간에 한 번)
GitHub Actions **ETL item** 워크플로로 그 부동산만 수집하고, 상세 화면이 단계별 진행을 보여 주며 끝난 항목부터 채운다.

1. GitHub → Settings → Developer settings → Fine-grained tokens → 새 토큰: Repository access = 이 리포만, Permissions → **Actions: Read and write**
2. Vercel 환경 변수: `GITHUB_DISPATCH_TOKEN`(토큰), `GITHUB_DISPATCH_REPO`(`owner/repo`), (선택) `GITHUB_DISPATCH_REF`(기본 `main`)
3. 관리 → 시스템 → 키 점검의 "개별 수집" 행이 정상인지 확인

| 단계(`item_collect_runs.steps`) | 하는 일 |
|---|---|
| `trades` | 이 부동산 유형의 실거래(매매·전월세) 최근 12개월 → 단지 매칭 → 좌표(내 동네 먼저) → 관심 부동산 ↔ 단지 연결 |
| `attrs` | 이 필지 건축물대장·토지특성·이용계획·공시가격 |
| `location` | 주변 편의시설 수집 → 입지 점수(같은 시군구 단지 백분위 포함) |
| `valuation` | 추정 시세 |
| `news` | 키워드 뉴스 수집 + 소량 동기 분류 |
| `history` | 13~36개월 전 실거래 → 자체 지수·추정 시세 재계산 |

- 한 단계가 실패해도 다음 단계를 계속한다. 대기 10분·실행 40분이 넘으면 화면에서 '멈춤'으로 닫고 다시 요청할 수 있다.
- 공공데이터 호출량은 매일 수집과 같은 `api_quota` 한도를 나눠 쓴다(아파트 1건 등록 ≈ 매매·전월세 72회).
- 로컬 개발: 루트 `.env` 에 `ITEM_COLLECT_LOCAL=1` 이면 `services/etl` 에서 `uv run myrealty item` 을 직접 띄운다.
- 지도 "이 지역 데이터 모으기"(마이그레이션 `0017_region_requests.sql`): 켜진 수집 대상이 `REGION_TARGET_CAP`(기본 40) 미만이면 바로 켜고, 넘으면 `region_requests.status = 'pending'` 으로 남는다. 관리 › 수집 지역에서 켜거나 거절한다. 역지오코딩에 `VWORLD_KEY` 가 필요하다.
- 실거래 저장은 여러 행을 한 문장으로 보내(`jsonb_to_recordset`) GitHub(미국) ↔ DB(서울) 왕복을 줄였다 — 매일 수집도 함께 빨라진다.

## 5. 운영 팁

- **호출 한도**: 공공데이터포털 개발계정은 서비스별 일일 한도가 있다. `QUOTA_DATA_GO_KR`(기본 900)에 걸리면 남은 작업은 다음 날로 이월된다. 관심 지역이 많아지면 활용 사례를 등록해 운영계정으로 전환한다. 사용량은 `api_quota` 테이블.
- **처음 등록한 지역**: 부동산을 등록하면 해당 시군구가 `collect_targets` 에 추가되고, 다음 daily 실행부터 최근 3개월 → 과거 순으로 채워진다. 빨리 채우려면 Actions 에서 `only: rtms backfill geocode link indicators avm` 로 수동 실행.
- **통계 코드**: ECOS·KOSIS·R-ONE 통계표·항목 코드는 `services/etl/src/myrealty_etl/series_catalog.py` 에 있다. 수집 오류가 나면 각 포털 코드 검색으로 확인 후 수정하거나 `SERIES_OVERRIDES_JSON` 으로 덮어쓴다(`enabled: False` 항목은 코드 확인 후 켠다).
- **통계 코드 점검**: `uv run myrealty series-check` 는 카탈로그의 모든 항목(비활성 포함)을 최근 2년으로 한 번씩 호출해 `ok`(값 있음) / 오류 / 코드 미입력을 보여 준다.
  `ok: true` 인 비활성 항목은 코드를 고치지 않고 켤 수 있다:
  ```bash
  # GitHub Actions 시크릿 또는 .env
  SERIES_OVERRIDES_JSON='{"ecos": {"ecos.housing_csi": {"enabled": true}, "ecos.household_mortgage": {"enabled": true}},
                          "kosis": {"kosis.permits": {"itmId": "...", "objL1": "...", "enabled": true}},
                          "reb": {"reb.supply_demand": {"statbl": "...", "region_filter": "...", "enabled": true}}}'
  ```
  켜진 항목은 지표 › 금리·물가 탭(수요 심리·주담대 증가율·인허가·준공 후 미분양)과 시장 해석 규칙에 자동으로 쓰인다.
- **실거래 상세 필드**: 마이그레이션 0005 가 매수자·매도자 구분, 등기일자, 전월세 신규/갱신·종전 보증금을 저장한다(기존 행은 원천 `raw` 에서 채움). 등기일은 신고 몇 달 뒤 붙으므로 최근 3개월 재수집 때 갱신된다.
- **분양가 비교**: 청약 공고 중 관심 시도 공고만 주택형별 분양가를 한 번 더 조회한다(공고당 1회, 공공데이터포털 청약홈 API 한도 사용).
- **지도 레이어**: 용도지역은 브이월드 WMS 가 필요하다(`VWORLD_KEY`, 서비스 URL 에 배포 도메인·localhost 등록, 필요하면 `VWORLD_DOMAIN`). 지적도는 네이버 지도에서는 네이버 지적편집도를, 대체 지도에서는 브이월드 WMS 를 쓴다.
- **AI 비용**: 모델은 `ANTHROPIC_MODEL`(대화·분석·리포트), `ANTHROPIC_BULK_MODEL`(뉴스 분류)로 바꾼다. 월 예산 `AI_MONTHLY_BUDGET_USD` 를 넘으면 새 요청을 막는다. 사용량은 `ai_usage` 테이블·설정 화면. Opus 5 계열은 안전 분류기 거절 시 권장 모델로 자동 재시도하는 server-side fallbacks 를 사용한다.
- **데모 데이터**: `uv run myrealty seed-demo --email ...` 은 이름에 `[데모]` 가 붙은 합성 데이터를 만든다. 실데이터 운영 전 `uv run myrealty seed-demo --reset` 으로 지운다(합성 거시 시계열도 삭제되므로 이후 `macro` 가 실제 값으로 채운다).
- **백업**: Supabase 는 일일 백업 제공(무료는 7일). 자체 DB 는 `pg_dump` 를 주기 실행.

## 6. 문제 해결

| 증상 | 원인·조치 |
|---|---|
| RTMS 오류 30 / `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` | 활용신청 승인 전이면 승인 후 1~2시간 대기. Encoding 키(`%2F`·`%3D` 포함)를 넣어도 웹·ETL 이 자동으로 풀어 쓴다(예전 웹은 두 번 인코딩해 등록 화면·중계가 실패했음) |
| 공공데이터포털 403 — 상가정보(`B553077`)·병원정보(`B551182`) | 그 API 의 활용신청이 없음 → 신청하면 입지 점수의 학원·의료·음식 항목이 채워진다(`myrealty pois` 로 바로 다시 계산) |
| 전남광주통합특별시 부동산의 지목·면적·공시지가가 빔 | 브이월드가 옛 코드(전남 46xxx·광주 29xxx)로만 답함 → 시군구 이름으로 옛 코드를 찾아 다시 조회한다([02 문서](02-data-sources.md) 식별자 체계). 다른 지역이 개편되면 `LEGACY_SGG_BY_NAME` 에 추가 |
| 뉴스 수집 401(`NID AUTH Result Invalid`) | 네이버 클라우드 **NAVER API HUB** 키(ID 10자·Secret 40자)를 개발자센터 주소로 불렀던 문제 → 이제 키 형식으로 API HUB/개발자센터를 골라 부르고, 인증 실패면 다른 쪽도 시도한다. 둘 다 실패하면 API HUB 콘솔에서 검색(뉴스) API 연결을 확인 |
| 휴대폰에서 `http://192.168.x.x:3000`(개발 서버)으로 열면 화면은 뜨지만 "로그인 코드 받기"가 반응 없음 | Next 16 개발 서버가 localhost 가 아닌 주소의 개발용 JS 요청을 막았음 → `next.config.ts` 의 `allowedDevOrigins` 에 사설망 대역을 넣음(개발 서버 재시작 필요). 사설망 밖 주소는 `DEV_ORIGINS` |
| RTMS 오류 22 | 일일 트래픽 초과 → 다음 날 자동 이월 |
| GitHub Actions 에서만 공공데이터포털 403(오류 30)·브이월드 "Server disconnected" | 러너가 해외(미국)라 거부·차단되거나 GitHub Secrets 의 키가 웹과 다름. **국내 API 중계**: GitHub Secrets 에 `CRON_SECRET`(Vercel 과 같은 값), Variables 에 `APP_URL` 을 넣으면 직접 호출이 실패할 때 웹(Vercel 서울 리전, `/api/relay`)이 **웹의 키**로 대신 호출한다. 키 점검 표의 "국내 API 중계(웹 경유)"가 정상이면 된다. 항상 중계하려면 Variables `KR_RELAY=always`, 끄려면 `off` |
| `APP_URL` 접속 실패(UnsupportedProtocol) | `https://` 를 빼고 넣음 → 이제 자동으로 붙인다(그래도 `https://myrealty.vercel.app` 처럼 넣는 것을 권장) |
| 주변 거래·입지가 "좌표가 없어…" | 등록 때 지오코딩이 실패한 부동산. 이제 지도·상세 화면을 열 때와 개별/매일 수집(`item_geom`) 때 주소로 다시 찾는다(도로명 → 지번 → '산' 붙여 쓰기 → 읍면동 중심). 오류로 실패한 결과는 캐시하지 않고, '좌표 없음' 캐시도 3일 뒤 다시 시도 |
| 임야·토지(건물 없는 필지)가 주소 검색에 안 나옴 | 도로명주소 API 는 건물 있는 주소만 준다 → 지번으로 검색하면 브이월드 주소 검색(없으면 네이버 지오코딩+역지오코딩)으로 필지를 찾는다. 웹에 `VWORLD_KEY` 또는 NCP 키(Geocoding·Reverse Geocoding 사용 설정) 필요 |
| 금리·물가가 "데이터 없음" | ECOS 키를 넣은 뒤 아직 매일 수집이 돌지 않음 → 부동산 "다시 불러오기"(금리·물가·지역 지표 단계가 하루 넘게 묵은 거시 지표를 받음) 또는 Actions › ETL daily 실행 |
| 지도에 주변 시설이 없음 | 공공 API·표준데이터 CSV 가 없어도 OpenStreetMap(Overpass)에서 지하철·학교·공원·병원·마트를 보충한다(화면 확대 시, 30일 캐시). 입지 점수도 ETL 이 같은 원천을 쓴다 |
| 지도가 빈 화면(회색) | (이전 버전) Tailwind 의 `img { max-width: 100% }` 가 지도 타일을 0px 로 줄이던 문제 → 수정됨. 지금은 네이버 키가 없거나 인증에 실패하면 대체 지도가 뜬다 |
| 지도 위 "네이버 지도 인증에 실패했습니다" | NCP Maps Application 에 Dynamic Map 선택, Web 서비스 URL 에 안내된 주소 등록. `NCP_MAPS_KEY_ID` 는 **Client ID**(Secret 아님) |
| 지도 좌하단 "대체 지도" | `NCP_MAPS_KEY_ID` 미설정. 배경은 `VWORLD_KEY` 가 있으면 브이월드(서비스 URL 에 배포 도메인 등록), 없거나 실패하면 OpenStreetMap |
| 어떤 키가 빠졌거나 틀렸는지 모르겠음 | 아래 **7. 키 점검** |
| 화면이 느림(누를 때마다 1초 이상) | 관리 → 시스템 → **DB 응답 속도**가 30ms 를 넘으면 웹 함수와 DB 지역이 다름 → 아래 **8. 속도** |
| "로그인 코드 받기" 후 *This page couldn't load / A server error occurred* | (이전 버전) 서버 오류가 그대로 노출됨. 현재는 원인별 문구와 오류 번호가 표시된다. `/api/health` 로 확인: `db:error`(DATABASE_URL·네트워크·Supabase 는 IPv4 풀러 주소 사용), `pendingMigrations`(`uv run myrealty migrate`), `authSecret:false`(AUTH_SECRET) |
| 화면이 몇 번에 한 번 빈 채로 수십 초 멈추다 오류(개발·테마·지도 등), `/api/health` 가 `db:error` · `57014` | postgres.js 가 한 연결에 쿼리를 이어 보내는 **파이프라이닝**과 Supabase 트랜잭션 풀러(6543)가 충돌해 쿼리가 응답 없이 멈추고, 멈춘 DB 연결이 다른 요청까지 막았다(로컬에서 동시 쿼리로 재현: 켜면 25초 멈춤, 끄면 정상). 이제 풀러 주소면 파이프라이닝을 끄고(`db-config.ts` `maxPipeline`, 덮어쓰기 `DATABASE_PIPELINE`), 실행한 쿼리가 25초 안에 끝나지 않거나 서버리스에서 30초 넘게 쉰 연결 묶음은 새로 만든다(`db-resilient.ts`, 로그 `[db] 연결 묶음을 새로 만듦`) |
| 휴대폰 지도에서 누르다 보면 카드·글자가 지도와 함께 크게 확대됨 | 16px 보다 작은 입력칸·선택 상자를 누르면 iOS 가 화면 전체를 확대 → 터치 기기 입력 글자를 16px 이상으로, 지도 화면 위 카드·패널에서는 페이지 확대(두 손가락·두 번 탭·PC 트랙패드 핀치)를 막고 지도만 확대되게 했다 |
| "데이터베이스에 연결할 수 없습니다" | `DATABASE_URL` 확인. 자체 서버는 루트 `.env` 가 읽히는지(`/api/health` 의 `authSecret`), Vercel 은 Transaction pooler(6543) 주소 사용 |
| "스키마가 최신이 아닙니다" | `cd services/etl && uv run myrealty migrate` |
| "메일을 보내지 못했습니다" | `SMTP_*` 확인(Gmail 은 앱 비밀번호, 465 포트는 SSL). 서버 로그에서 오류 번호로 상세 원인 확인 |
| 로그인 코드 메일이 오지 않음 | 스팸함 확인. 가입 방식이 "허용 목록만"·"가입 중지"이거나 정지된 계정이면 같은 응답을 주지만 발송하지 않음(관리 → 사이트 설정) |
| 자동 로그인이 안 됨 | 로그인 시 "이 기기 기억하기"를 켜야 90일(접속 시 연장) 유지. 끄면 브라우저를 닫을 때 로그아웃 |
| 관리 메뉴가 없음 | `ADMIN_EMAILS` 에 이메일이 있는지, 변경 후 서버를 재시작했는지 확인 |
| iPhone 에서 푸시 버튼이 없음 | iOS 16.4+ 에서 홈 화면에 추가한 앱으로 열어야 함 |
| 단지가 "연결되지 않았습니다" | 해당 시군구 실거래가 아직 수집되지 않음 → rtms·link 실행 후 재확인 |
| 지표 화면이 비어 있음 | 시군구 아파트 매매가 30건 미만이면 지표를 계산하지 않음(표본 부족) |

## 7. 키 점검 (Vercel · GitHub)

웹(Vercel)과 ETL(GitHub Actions)은 환경 변수를 따로 갖고 있어 한쪽만 빠지거나 서로 다른 값이 들어가기 쉽다. 두 곳을 한 화면에서 비교한다.

| 어디서 | 방법 | 결과 |
|---|---|---|
| 웹(Vercel) | 관리 → 시스템 → **키 점검** → "실제 호출로 점검" | 각 키로 가벼운 요청을 보내 정상 / 미설정(필수·선택) / 오류(원인·조치) 표시 |
| GitHub Actions | Actions → **Check keys** → Run workflow (매일 ETL 에서도 자동 실행) | 실행 요약(Summary)에 같은 표. `DATABASE_URL` 이 맞으면 관리 화면의 GitHub 열에도 표시 |
| 로컬 | `cd services/etl && uv run myrealty doctor` | 콘솔 표 |

- 값은 어디에도 출력하지 않고 **지문(SHA-256 앞 8자리)** 만 보여 준다. 관리 화면 "같은 키?" 열이 "다름"이면 두 곳에 서로 다른 값이 들어가 있다.
  `DATABASE_URL` 은 호스트·포트·DB 이름만으로 지문을 만들어 웹과 ETL 이 같은 DB 를 보는지 알 수 있다.
- `CRON_SECRET` 은 Check keys 워크플로가 웹의 `/api/cron/reports?kind=check` 를 직접 호출해 두 곳 값이 같은지 확인한다(리포트는 만들지 않음). `APP_URL` 은 GitHub **Variables** 에 넣는다.
- 확인하는 것: 공공데이터포털(실거래·건축물대장 활용신청 여부, 오류 20/22/30/31/32), 브이월드(키·도메인), 도로명주소, NCP 지오코딩, 네이버 검색, ECOS·KOSIS·R-ONE,
  Claude(키·모델 이름), SMTP 로그인, VAPID 공개키·비밀키 쌍(웹은 빌드에 들어간 공개키가 현재 값과 같은지도), AUTH_SECRET 길이, APP_URL 과 실제 주소.
- 네이버 지도 표시(Dynamic Map)는 브라우저에서 도메인으로 인증하므로 서버에서 확인할 수 없다. 지도 화면에서 인증 실패 안내가 뜨는지 본다.
- Vercel 에서 값을 바꾼 뒤에는 **재배포**해야 반영된다(`NEXT_PUBLIC_*` 는 빌드에 들어감).

## 8. 속도

화면 하나를 그리려면 DB 에 여러 번 묻는다. 서버가 아무리 빨라도 **웹 함수 ↔ DB 왕복 시간 × 순차 왕복 수**만큼 기다리게 된다.
Vercel 기본 지역(미국 동부 `iad1`)과 Supabase 서울은 왕복이 약 180~200ms 라, 쿼리당 왕복 2회(Transaction pooler)면 화면당 1~2초가 DB 대기로 사라진다.

| 확인 | 방법 |
|---|---|
| 웹 함수 지역·DB 왕복 시간 | 관리 → 시스템 → **DB 응답 속도**(또는 `/api/health` 의 `region`·`dbRttMs`). 한 자리 ms 면 정상, 30ms 이상이면 지역이 다름 |
| prepared statement | 같은 줄에 "사용(쿼리당 왕복 1회)" / "끔(왕복 2회)" 표시 |

**1) 지역 맞추기(효과가 가장 큼).** `apps/web/vercel.json` 의 `regions` 를 DB 지역에 맞춘다(기본 `icn1`). Supabase 지역은 바꿀 수 없으니 Vercel 쪽을 맞춘다.

| Supabase 지역 | Vercel `regions` |
|---|---|
| Northeast Asia (Seoul) `ap-northeast-2` | `icn1` |
| Northeast Asia (Tokyo) `ap-northeast-1` | `hnd1` |
| Southeast Asia (Singapore) `ap-southeast-1` | `sin1` |
| East US (N. Virginia) `us-east-1` | `iad1` |
| West US (N. California) `us-west-1` | `sfo1` |

바꾼 뒤 재배포하고 DB 응답 속도가 한 자리 ms 인지 확인한다. (공공 API 중 일부는 해외 IP 를 막기도 해서 서울 지역이 유리하다.)

**2) 쿼리당 왕복 1회로.** postgres.js 는 prepared statement 를 끄면(트랜잭션 풀러) 매 쿼리를 Parse/Describe 로 한 번 더 왕복한다.
Supabase **Session pooler**(pooler 호스트 5432) 주소를 쓰면 자동으로 켜진다. 개인·소규모 사용이면 접속 수 한도에 걸릴 일이 거의 없다.

**3) 앱에서 한 일.** 로컬에서 DB 왕복마다 80ms 를 인위로 더해 측정한 결과(같은 데이터·빌드 기준, 초):

| 화면 | 이전 | 이후 | prepare 끔(이후) |
|---|---|---|---|
| 홈 | 0.55 | 0.19 | 0.35 |
| 관심 부동산 | 0.27 | 0.10 | 0.18 |
| 부동산 상세(개요) | 0.52 | 0.18~0.26 | 0.39 |
| 지도 | 0.43 | 0.10 | 0.18 |
| 지표 | 0.64 | 0.24 | 0.56 |
| 첫 요청(새 인스턴스, 연결 생성 포함) | 1.25 | — | — |

- 세션 확인과 화면 쿼리를 동시에 시작(서명된 세션의 사용자 ID 로 먼저 조회하고, 폐기·정지 확인이 실패하면 결과를 버리고 쿠키를 지운 뒤 방문자로 — `pageUser`).
- 안 읽은 알림 수를 세션 확인 쿼리에 합침, 사이트 설정은 서버 메모리에 30초 캐시, 접속 기록 갱신은 응답 뒤(`after`)로.
- 서로 의존하지 않는 쿼리는 동시에(지도·설정·포트폴리오·AI·지표·비교·입지 탭·개요 탭 등).
- `loading.tsx` 뼈대 화면: 누르는 즉시(0.1초 안) 화면이 바뀌고 데이터가 오면 채워진다.

