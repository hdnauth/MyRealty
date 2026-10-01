# 10. AI 제공자 선택 · 지도 조건 검색 · 지도 전체 화면

> 요청: ① AI 를 Claude 외에 MiMo·DeepSeek·GPT·Gemini·Ollama 로도 쓸 수 있게 — 각 사용자가 앱에서 제공자·모델·키를 직접 설정,
> 모델 목록은 제공자 서버에서 불러와 고르기. ② 지도에서 여러 조건·지표 범위로 관심 가질 부동산을 찾고 골라 보기.
> ③ 지도의 전체 화면 아이콘을 누르면 우리나라 전체가 보이는 문제.

## 1. AI 제공자 선택 ✅

### 1.1 구조

| 계층 | 파일 | 역할 |
|---|---|---|
| 카탈로그 | `lib/ai/providers.ts` | 제공자별 기본 Base URL, 토큰 파라미터 이름, json_schema 지원, reasoning 되돌림 여부, 추천 모델(설정 화면 공용) |
| 설정 해석 | `lib/ai/client.ts` `resolveAi` · `requireAi` | 사용자 설정(본인 키) → 없으면 서버 기본(`ANTHROPIC_API_KEY`). 서버 키일 때만 월 예산·개인 한도 확인 |
| 호출 | `lib/ai/engine.ts` | `generateObject`(분석·비교) · `generateText`(리포트) · `runChat`(도구 호출 대화) — 제공자 중립 |
| Claude | 기존 Anthropic SDK | 프롬프트 캐시·effort·서버 폴백·구조화 출력·toolRunner 그대로 |
| 그 밖 | `lib/ai/openai-compat.ts` | OpenAI Chat Completions 호환(GPT·Gemini·DeepSeek·MiMo·Ollama), fetch 기반 스트리밍·도구 호출 루프 |
| 모델 목록 | `lib/ai/models.ts` | Anthropic `/v1/models`, 나머지 `{base}/models`(Ollama 는 `/api/tags` 보조). 임베딩·음성·이미지 모델은 거른다 |
| 키 보관 | `lib/ai/secret.ts`, `user_ai_settings` | AES-256-GCM(`AI_KEY_SECRET`, 없으면 `AUTH_SECRET` 파생). 화면에는 끝 4자리만 |
| 도구 | `lib/ai/tools.ts` | `defineTool`(zod 스키마) — Claude 는 `betaZodTool`, 나머지는 `z.toJSONSchema` 로 function 정의 |

### 1.2 제공자별 차이 처리

| 제공자 | 기본 Base URL | 출력 상한 파라미터 | 구조화 출력 | 비고 |
|---|---|---|---|---|
| Anthropic | api.anthropic.com | max_tokens | SDK `parse` | 사용자 키도 같은 경로 |
| OpenAI | api.openai.com/v1 | max_completion_tokens | json_schema | |
| Gemini | generativelanguage.googleapis.com/v1beta/openai | max_tokens | json_schema(additionalProperties 제거) | 도구 호출의 `extra_content`(thought signature)를 그대로 되돌림 |
| DeepSeek | api.deepseek.com | max_tokens(chat 8K·reasoner 32K로 자름) | json_object + 프롬프트 스키마 | 같은 턴의 도구 호출 사이 `reasoning_content` 되돌림 |
| MiMo | api.xiaomimimo.com/v1 | max_completion_tokens | json_object + 프롬프트 스키마 | reasoning_content 되돌림 |
| Ollama | localhost:11434/v1 | max_tokens | json_schema | 키 선택, http 허용. 도구 미지원 모델은 안내 문구 |

- 제공자가 특정 파라미터를 거부(400)하면 그 파라미터를 바꾸거나 빼고 한 번 더 보낸다(`stream_options`, `response_format` json_schema→json_object, `max_tokens`↔`max_completion_tokens`).
- 구조화 출력은 zod 로 검증하고, 어긋나면 오류를 알려 주고 한 번 더 받는다.
- 오류 문구에 키가 섞여 오면 `***` 로 가린다.

### 1.3 비용·한도
- 본인 키 사용분은 `ai_usage.own_key = true`, `cost_usd = 0` 으로 남겨 서버 예산(`AI_MONTHLY_BUDGET_USD`)·개인 한도에서 빠진다. 설정 화면에 "내 키 n회"로 따로 표시.
- 서버 예산·개인 한도를 넘으면 "본인 키를 등록하면 계속 쓸 수 있다"고 안내.
- 정기 리포트(cron)도 사용자별 설정을 따른다. 설정도 서버 키도 없으면 건너뜀.
- ETL 뉴스 분류(Python)는 사용자와 무관한 배치라 서버 키(Claude)를 그대로 쓴다.

### 1.4 보안 메모
- Base URL 은 https 만(Ollama 만 http 허용), 계정 정보·쿼리 제거. 사용자 입력 주소로 서버가 요청을 보내는 구조라(SSRF) 응답 원문은 돌려주지 않고 모델 이름·오류 요약만 보여 준다.
  공개 가입을 넓히면 관리 설정에 "사용자 지정 Base URL 허용" 스위치를 두는 것을 검토.
- `AI_KEY_SECRET`(또는 `AUTH_SECRET`)을 바꾸면 저장된 키를 풀 수 없다 → 화면에 "키를 다시 입력" 안내, 그동안 서버 기본으로 동작.
- Ollama 는 **웹 서버에서** 닿는 주소여야 한다(Vercel 배포면 localhost 불가 — 터널·공인 주소 필요).

## 2. 지도 조건 검색 ✅

### 2.1 조건과 지표

`/api/map/points` 가 화면 범위(bbox) 안 단지(아파트·오피스텔·빌라) 또는 읍면동(단독·토지·상가)을 집계하면서 조건을 적용한다.

| 조건 | 기준 | 적용 위치 |
|---|---|---|
| 가격(중위) | 고른 거래 유형(매매/전세)·기간의 중위 | 집계 뒤 |
| 평당가/㎡당 | 같은 기간 단위면적당 중위 | 집계 뒤 |
| 면적 | 이 면적의 거래만 집계(국민평형만 보기 등) | 집계 전 |
| 준공 연도 | `complexes.build_year` | 단지 선택 단계 |
| 세대수 | `complexes.households` — **대장을 불러온 단지만** 값이 있음 | 단지 선택 단계 |
| 전세가율 | 최근 12개월 전세 ㎡당 중위 ÷ 매매 ㎡당 중위 | 집계 뒤 |
| 1년 변화 | 최근 6개월 vs 12~18개월 전 매매 ㎡당 중위(각 2건 이상) | 집계 뒤 |
| 입지 점수 | `location_scores`(complex) — **계산된 단지만** | 집계 뒤 |

- 응답은 최대 400곳(거래 많은 순). 넘으면 `truncated` → "지도를 확대하면 더 정확" 안내.
- 수원 일대(540단지, 거래 4만 건)에서 실행 0.24초(운영 DB `explain analyze`).

### 2.2 화면
- 상단 `조건 검색` 칩 → 조건 패널(빠른 조건·정렬·범위 입력·빠른 구간 버튼). 조건과 정렬은 이 기기에 기억.
- 빠른 조건: 신축(10년 이내) · 갭 작은 곳(전세가율 70%+) · 국민평형 10억 이하 · 재건축 연한(30년+) · 1년 +5% 이상 · 입지 70점+.
- 정렬을 바꾸면 가격 라벨 아래 줄이 그 지표로 바뀐다(전세가율 72%, 1년 +5.3%, 입지 81점, 2019년).
- 목록 각 행과 선택 카드에 준공·세대·전세가율·1년 변화·입지 점수를 함께 표시 → 단지 상세·관심 등록으로 이어짐.

### 2.3 다음 단계 ⬜
- 세대수·입지 점수가 채워진 단지가 적다(운영 DB 기준 입지 점수 29단지). 관심 단지 주변부터 건축물대장·입지 계산을 넓히면 필터가 쓸모 있어진다.
- 조건을 이름 붙여 저장 + 새로 맞는 단지가 생기면 알림(저장 검색).
- 지표 단계 구분 색(라벨 색=전세가율 등)과 범례.
- 지역 지표(시장 온도·공급 압력) 조건: 시군구 단위라 단지 필터와 섞으려면 단지 → 시군구 매핑을 응답에 포함.

## 3. 지도 전체 화면 ✅

- 원인: 오른쪽 아래 `⤢`(Maximize2) 버튼이 실제로는 "내 부동산 모두 보기"(fitBounds)였다. 서울·전남처럼 멀리 떨어진 부동산이 있으면 전국이 한 화면에 보였다.
- 변경
  - `⤢` = **전체 화면**(Fullscreen API, 안 되는 브라우저 — iPhone Safari 등 — 는 화면을 덮는 고정 배치). 전체 화면에서는 목록을 접고 `목록` 버튼으로 연다. 단지·핀을 누르면 목록이 열린다. Esc 로 닫힘.
  - `★` = 내 부동산 보기: 40km 안에 이어지는 것끼리 묶어, 처음에는 지금 화면에서 가장 가까운 묶음을, 다시 누르면 다음 지역을 보여 준다.
