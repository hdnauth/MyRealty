// 개인정보처리방침·이용약관·탈퇴 안내(공개 페이지 /legal/*)에 쓰는 값. 처리 방식이 바뀌면 여기와 시행일을 함께 고친다.

/** 시행일(문서를 고치면 바꾼다) */
export const LEGAL_EFFECTIVE = { privacy: "2026-10-02", terms: "2026-10-02" };

/** 개인정보 처리 위탁·국외 이전. 실제 쓰는 서비스와 저장 지역을 맞춰야 한다 */
export const PROCESSORS: { name: string; country: string; task: string; items: string; when: string }[] = [
  { name: "Vercel Inc.", country: "미국(서버 함수는 서울 리전에서 실행)", task: "웹 서비스 호스팅", items: "서비스 이용 중 전송되는 모든 정보, 접속 IP", when: "서비스 이용 시 네트워크로 전송" },
  { name: "Supabase Inc.", country: "미국(데이터는 프로젝트 지역에 저장)", task: "데이터베이스 운영", items: "아래 '처리하는 개인정보' 전부", when: "저장 시 네트워크로 전송" },
  { name: "GitHub Inc.", country: "미국", task: "공공데이터 수집·지표 계산·알림 발송 작업 실행", items: "관심 부동산 주소·면적, 알림 설정, 이메일 주소(알림 메일)", when: "매일 정해진 시각 작업 실행 시" },
  { name: "Anthropic PBC", country: "미국", task: "AI 질문 답변·분석·리포트·커뮤니티 요약과 검토", items: "AI 질문 내용과 답변에 필요한 관심 부동산 정보, 커뮤니티 글", when: "AI 기능을 쓸 때" },
  { name: "메일 발송 서비스(SMTP)", country: "서비스 제공자에 따름", task: "로그인 코드·알림·리포트 메일 발송", items: "이메일 주소, 메일 내용", when: "메일 발송 시" },
];

/** 사용자가 설정에서 직접 고른 경우에만 쓰는 AI 제공자 */
export const OPTIONAL_AI_PROVIDERS = "OpenAI(미국), Google(미국), DeepSeek(중국), Xiaomi MiMo(중국), 사용자가 지정한 Ollama 서버";
