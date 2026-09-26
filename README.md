# MyRealty — 나만을 위한 부동산 인텔리전스 웹앱

공공 DB(실거래가·건축물대장·공시가격·토지이용계획·경제지표 등), 네이버 지도, 뉴스·정책 정보를 결합하고
AI 분석을 더해 **내가 관심 있는 부동산을 중심으로** 시장을 해석해 주는 개인용 웹앱입니다.

- 모바일 우선(PWA, 홈 화면 설치), PC 반응형 지원
- 이메일 OTP(6자리 코드) 기반의 간단한 로그인, 허용된 이메일만 접근
- 아파트 · 연립/다세대(빌라) · 단독/다가구 · 오피스텔 · 토지 · 임야 · 상가 등록 및 추적
- 유사 물건 비교, 관련 뉴스·정책·이벤트 자동 연결, 조합 지표, AI 질의응답·리포트

## 구성

```
apps/web/         Next.js 16 웹앱 (모바일 우선 PWA, 이메일 OTP 로그인)
services/etl/     Python 수집·지표·AI 배치 (CLI: myrealty)
db/migrations/    Postgres(PostGIS·pgvector) 스키마
.github/workflows CI, 매일 ETL 실행
```

## 빠른 시작 (로컬)

사전 준비: Node 20.9+, pnpm, Python 3.11+, [uv](https://docs.astral.sh/uv/), PostgreSQL 16 + PostGIS + pgvector

```bash
cp .env.example .env              # AUTH_SECRET, ALLOWED_EMAILS 최소 설정
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
- 공공 API 키를 넣으면 `uv run myrealty daily` 가 관심 물건이 있는 시군구의 실거래를 수집합니다.
- 데모 데이터 삭제: `uv run myrealty seed-demo --reset`

## 계획 문서

| 문서 | 내용 |
|---|---|
| [01. 제품 기획 · 기능 명세](docs/01-product-features.md) | 사용 시나리오, 화면 구성, 기능 목록과 우선순위 |
| [02. 데이터 소스](docs/02-data-sources.md) | 공공 API 목록, 식별자 체계(법정동코드·PNU), 수집 전략과 제약 |
| [03. 아키텍처 · 데이터 모델](docs/03-architecture.md) | 기술 스택, 인증, ETL, DB 스키마, 디렉터리 구조 |
| [04. 조합 지표 · AI 분석](docs/04-indicators-and-ai.md) | 새로 정의하는 지표들의 산식, 유사 물건·시세 추정 알고리즘, AI 기능 설계 |
| [05. 로드맵 · 리스크](docs/05-roadmap.md) | 단계별 마일스톤, 비용, 리스크와 대응, 바로 할 일 |

> 본 앱의 정보·분석은 참고용이며 투자 자문이 아닙니다.
