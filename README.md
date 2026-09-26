# MyRealty — 나만을 위한 부동산 인텔리전스

공공 DB(실거래가·건축물대장·공시가격·토지이용계획·경제지표 등), 네이버 지도, 뉴스·정책 정보를 결합하고
AI 분석을 더해 **내가 관심 있는 부동산을 중심으로** 시장을 해석해 주는 개인용 웹앱입니다.

<p>
<img src="docs/screenshots/mobile-home.jpg" width="200" alt="모바일 홈">
<img src="docs/screenshots/mobile-item.jpg" width="200" alt="물건 개요">
<img src="docs/screenshots/mobile-location.jpg" width="200" alt="입지 점수">
</p>
<img src="docs/screenshots/desktop-indicators.jpg" width="640" alt="지표 대시보드(PC)">

> 스크린샷은 `seed-demo` 합성 데이터입니다(실제 시세 아님).

## 주요 기능

| 영역 | 기능 |
|---|---|
| 계정 | 이메일 6자리 코드(OTP) 로그인, 허용 이메일 목록, 기기별 세션 관리 |
| 관심 물건 | 아파트·빌라·오피스텔·단독·토지·임야·상가를 주소로 등록(PNU·좌표·단지 자동 연결), 매입·대출·임대 정보, 메모·유형별 체크리스트 |
| 시세·거래 | 실거래 11종 수집(해제·직거래 표시), 가격 차트, 신고가·3년 최저 탐지, **추정 시세(AVM)** 구간·신뢰도·백테스트 |
| 주변·비교 | 반경 내 거래, **유사 단지**(유사도 점수)와 상대 성과, 최대 5개 **비교** 표 + AI 비교 |
| 입지 | **생활편의 점수**(교통·학교·학원·의료·쇼핑·음식·공원), 지역 내 백분위, **정비사업·철도/도로 사업**, 재건축 연한·용적률 여유, 개통 전후 가격 변화 |
| 소식 | 키워드 뉴스 + Claude 관련도·호재/악재·요약, 주변 청약·입주 예정, 공시·세금 일정, 캘린더 |
| 지표 | 실거래 기반 **자체 가격지수**, 월부담지수·PIR·실질/유동성 보정·전세가율·회전율·신고가/하락 비율·공급압력, **시장 온도계**(요인별 기여), **커스텀 지표 빌더** |
| 도구 | 대출 시나리오(금리·가격 민감도, DSR), 깡통전세 위험 점검, 보유세 개략 추정, 포트폴리오 |
| AI | 내 데이터 도구 기반 **질문하기**(스트리밍), 물건 **분석 카드**, 주간/월간 **리포트**(메일) |
| 알림 | 신규 실거래·신고가·해제·관련 뉴스·주변 청약·만기·금리 변경·온도 구간 변화 → 웹푸시(중요) + 이메일 다이제스트 |
| 지도 | 네이버 지도: 단지별 평당가 라벨, 유형·매매/전세·기간 필터, 개발사업·지하철·학교·공원·병원·마트 레이어 |

모바일 우선(PWA, 홈 화면 설치·오프라인 캐시·웹푸시)이며 PC에서는 사이드바 + 2단 레이아웃으로 보입니다.

## 구성

```
apps/web/          Next.js 16 (App Router, React 19, Tailwind 4) — 화면·API·AI(Claude TS SDK)
services/etl/      Python 3.11 (uv) — 수집·지표·AVM·입지·뉴스 분류·알림 (CLI: myrealty)
db/migrations/     Postgres 16 + PostGIS + pgvector 스키마
.github/workflows  CI · 매일 ETL · 정기 리포트
docs/              기획·데이터·아키텍처·지표/AI·로드맵·운영 문서
```

## 빠른 시작 (로컬)

사전 준비: Node 20.9+, pnpm, Python 3.11+, [uv](https://docs.astral.sh/uv/), PostgreSQL 16 + PostGIS + pgvector

```bash
cp .env.example .env              # 최소: AUTH_SECRET, ALLOWED_EMAILS
createdb myrealty                 # DATABASE_URL 과 일치하게

cd services/etl
uv sync
uv run myrealty migrate           # 스키마 적용
uv run myrealty seed-demo --email you@example.com   # (선택) 키 없이 확인용 합성 데이터

cd ../../apps/web
pnpm install
pnpm dev                          # http://localhost:3000
```

- SMTP 를 설정하지 않으면 로그인 코드가 `pnpm dev` 콘솔에 출력됩니다.
- 공공 API 키를 넣고 `uv run myrealty daily` 를 실행하면 관심 물건이 있는 시군구의 데이터를 모읍니다.
- 데모 데이터 삭제: `uv run myrealty seed-demo --reset`
- 테스트: `cd apps/web && pnpm lint && pnpm typecheck && pnpm test` · `cd services/etl && uv run ruff check src tests && uv run pytest`
  (ETL 테스트는 로컬 Postgres 에 `myrealty_test` DB 를 만들어 사용, `TEST_DATABASE_URL` 로 변경 가능)

배포·스케줄·키 설정은 [06. 배포 · 운영 가이드](docs/06-operations.md)를 보세요.

## 문서

| 문서 | 내용 |
|---|---|
| [01. 제품 기획 · 기능 명세](docs/01-product-features.md) | 사용 시나리오, 화면 구성, 기능 목록과 우선순위 |
| [02. 데이터 소스](docs/02-data-sources.md) | 공공 API 목록, 식별자 체계(법정동코드·PNU), 수집 전략과 제약 |
| [03. 아키텍처 · 데이터 모델](docs/03-architecture.md) | 기술 스택, 인증, ETL, DB 스키마, 디렉터리 구조 |
| [04. 조합 지표 · AI 분석](docs/04-indicators-and-ai.md) | 지표 산식, 생활편의 점수, 유사 물건·AVM, AI 기능 설계 |
| [05. 로드맵 · 리스크](docs/05-roadmap.md) | 단계별 마일스톤(구현 현황), 비용, 리스크 |
| [06. 배포 · 운영 가이드](docs/06-operations.md) | 키 발급, DB·웹 배포, 스케줄, 운영 팁, 문제 해결 |

> 본 앱의 정보·분석은 참고용이며 투자 자문이 아닙니다. AVM·보유세·지표는 공공데이터 기반 추정치입니다.
