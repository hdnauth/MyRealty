// 커뮤니티 규칙(순수 함수): 말머리·신고 사유·닉네임 검증·작성 제한·활동 등급·저장 전 자동 점검

export const CATEGORIES = {
  question: { label: "질문", tone: "accent" },
  info: { label: "정보", tone: "ok" },
  opinion: { label: "의견", tone: "neutral" },
  review: { label: "임장 후기", tone: "warn" },
  life: { label: "생활", tone: "neutral" },
  data: { label: "데이터", tone: "up" }, // 시스템 글(신고가·청약 등)
} as const;
export type Category = keyof typeof CATEGORIES;
/** 사용자가 고를 수 있는 말머리(데이터는 시스템 글 전용) */
export const USER_CATEGORIES = ["question", "info", "opinion", "review", "life"] as const satisfies readonly Category[];
export function isUserCategory(v: unknown): v is (typeof USER_CATEGORIES)[number] {
  return typeof v === "string" && (USER_CATEGORIES as readonly string[]).includes(v);
}
export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && v in CATEGORIES;
}

export const REPORT_REASONS = {
  collusion: "집값 담합 유도",
  ad: "광고·영업·중개 홍보",
  abuse: "욕설·비방·혐오",
  privacy: "개인정보 노출(동·호수, 연락처 등)",
  false: "허위 사실",
  other: "기타",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === "string" && v in REPORT_REASONS;
}

export const LIMITS = {
  titleMax: 80,
  bodyMax: 5000,
  commentMax: 1000,
  imagesPerPost: 4,
  imageMaxBytes: 1_500_000,
  pollOptionsMax: 6,
  /** 가입 후 이 시간 안에는 더 적게 쓸 수 있다(스팸 계정 완화) */
  newAccountHours: 24,
  postsPerDay: { fresh: 3, normal: 20 },
  commentsPerDay: { fresh: 20, normal: 200 },
  reportsPerDay: 30,
  imagesPerDay: 20,
  postGapSec: 30,
  commentGapSec: 5,
} as const;

/** 하루 작성 수 한도(가입 직후 계정은 적게) */
export function dailyLimit(kind: "post" | "comment", accountCreatedAt: Date, now = new Date()) {
  const fresh = now.getTime() - accountCreatedAt.getTime() < LIMITS.newAccountHours * 3600_000;
  const t = kind === "post" ? LIMITS.postsPerDay : LIMITS.commentsPerDay;
  return fresh ? t.fresh : t.normal;
}

// ───────── 닉네임 ─────────

const RESERVED = ["관리자", "운영자", "운영진", "admin", "administrator", "myrealty", "마이리얼티", "시스템", "system", "탈퇴", "ai", "봇", "bot", "공지"];

/** 2–12자, 한글·영문·숫자·밑줄. 오류 문구 또는 null */
export function nicknameError(raw: string): string | null {
  const s = raw.trim();
  if (s.length < 2 || s.length > 12) return "닉네임은 2~12자로 정하세요.";
  if (!/^[가-힣a-zA-Z0-9_]+$/.test(s)) return "한글·영문·숫자·밑줄(_)만 쓸 수 있습니다.";
  if (/^\d+$/.test(s)) return "숫자만으로는 정할 수 없습니다.";
  const low = s.toLowerCase();
  if (RESERVED.some((r) => low.includes(r))) return "운영자·시스템으로 오해할 수 있는 단어는 쓸 수 없습니다.";
  if (screenText(s).flags.some((f) => f.code === "abuse")) return "쓸 수 없는 단어가 들어 있습니다.";
  return null;
}

// ───────── 활동 등급 ─────────

export const POINTS = { post: 3, comment: 1, likeReceived: 1, hidden: -10 } as const;
const LEVELS = [
  { min: 300, label: "터줏대감" },
  { min: 100, label: "단골" },
  { min: 20, label: "이웃" },
  { min: -Infinity, label: "새내기" },
] as const;
export function levelOf(points: number): { label: string; rank: number } {
  const i = LEVELS.findIndex((l) => points >= l.min);
  return { label: LEVELS[i].label, rank: LEVELS.length - 1 - i };
}

// ───────── 저장 전 자동 점검 ─────────

export type Flag = { code: "collusion" | "ad" | "abuse" | "privacy" | "link"; label: string };
export type Screen = {
  /** 개인정보를 가린 본문 */
  text: string;
  flags: Flag[];
  /** hold: 관리자(또는 AI) 확인 전까지 작성자에게만 보인다 */
  action: "pass" | "hold";
};

const MASKS: { re: RegExp; to: string | ((m: string, ...g: string[]) => string); flag?: Flag }[] = [
  // 주민등록번호
  { re: /\b\d{6}\s?-\s?[1-4]\d{6}\b/g, to: "******-*******", flag: { code: "privacy", label: "주민등록번호" } },
  // 휴대폰·지역번호 전화
  { re: /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, to: "010-****-****", flag: { code: "privacy", label: "전화번호" } },
  { re: /\b0(?:2|[3-6][1-5])[-.)\s]\d{3,4}[-.\s]\d{4}\b/g, to: "0**-****-****", flag: { code: "privacy", label: "전화번호" } },
  // 이메일
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, to: (m) => `***@${m.split("@")[1]}`, flag: { code: "privacy", label: "이메일" } },
  // 동·호수(101동 1203호) — 특정 세대를 지목하지 않도록
  { re: /\b\d{1,4}\s*동\s*\d{3,4}\s*호/g, to: "○○동 ○○○호", flag: { code: "privacy", label: "동·호수" } },
  // 계좌번호(은행 이름 근처의 숫자 묶음)
  {
    re: /((?:계좌|은행|국민|신한|우리|하나|농협|기업|카카오뱅크|토스|새마을|우체국)\D{0,6})\d{2,6}[-\s]\d{2,6}[-\s]\d{2,8}/g,
    to: (_m, p) => `${p}***-***-***`,
    flag: { code: "privacy", label: "계좌번호" },
  },
];

// 공인중개사법 제33조 제2항: 특정 가격 이하 중개 의뢰 제한·유도, 중개사 배제 등 시세 담합
const COLLUSION = [
  /(이하|아래|밑)(로|으로)?\s*(는|은)?\s*(절대\s*)?(팔|매도|내놓|내\s*놓|계약)(지|하지)?\s*(마|말|맙|않)/,
  /(가격|호가|시세)\s*(을|를)?\s*(담합|맞추자|맞춰\s*(요|주세요|봅시다)|지키자|지켜\s*(요|주세요)|사수)/,
  /(중개(업)?소|부동산|공인중개사|중개사)[^.\n]{0,15}(불매|보이콧|거래\s*(하지|금지|끊)|이용\s*(하지|금지)|가지\s*맙시다|가지\s*말)/,
  /(저가|급매|싼)\s*매물[^.\n]{0,12}(신고|허위\s*매물|내리게|삭제|못\s*올리게)/,
  /\d+\s*억\s*(이상|아래로는|밑으로는)\s*(만\s*)?(받|내놓|올리)(자|읍시다|기로)/,
];
const AD = [
  /(오픈\s*채팅|오픈톡|텔레그램|카톡\s*(문의|아이디|id|ID|주세요))/,
  /(문의\s*(주세요|환영|바랍니다|하세요)|상담\s*(문의|신청|가능))/,
  /(수익\s*보장|리딩방|무료\s*(상담|강의)|선착순\s*모집|분양\s*문의)/,
];
const ABUSE = /(씨\s*발|시\s*발|ㅅ\s*ㅂ|ㅆ\s*ㅂ|병\s*신|ㅂ\s*ㅅ|개\s*새\s*끼|좆|지\s*랄|미친\s*(놈|년)|꺼져|느금|니\s*애미|애미\s*(없|뒤)|한남충|김치녀|짱깨)/;
const URL = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/i;
// 공공·언론 등 정보 출처 링크는 허용
const URL_OK = /^(https?:\/\/)?([\w-]+\.)*(go\.kr|or\.kr|re\.kr|naver\.com|daum\.net|kakao\.com|youtube\.com|youtu\.be|molit\.go\.kr|applyhome\.co\.kr|reb\.or\.kr|news\.[\w.-]+|[\w-]+news\.(com|co\.kr)|yna\.co\.kr|chosun\.com|joongang\.co\.kr|donga\.com|hani\.co\.kr|khan\.co\.kr|mk\.co\.kr|hankyung\.com|sedaily\.com|edaily\.co\.kr|mt\.co\.kr)(\/|$)/i;

/** 개인정보 가리기 + 담합·광고·욕설 탐지. 탐지되면 hold */
export function screenText(input: string): Screen {
  const flags: Flag[] = [];
  let text = input;
  for (const m of MASKS) {
    if (m.re.test(text)) {
      if (m.flag && !flags.some((f) => f.label === m.flag!.label)) flags.push(m.flag);
      text = text.replace(m.re, m.to as never);
    }
    m.re.lastIndex = 0;
  }
  const plain = text.replace(/\s+/g, " ");
  if (COLLUSION.some((re) => re.test(plain))) flags.push({ code: "collusion", label: "담합 유도 의심" });
  if (AD.some((re) => re.test(plain))) flags.push({ code: "ad", label: "광고·영업 의심" });
  if (ABUSE.test(plain)) flags.push({ code: "abuse", label: "욕설·비방" });
  const urls = plain.match(new RegExp(URL, "gi")) ?? [];
  if (urls.some((u) => !URL_OK.test(u))) flags.push({ code: "link", label: "외부 링크" });
  // 개인정보는 가렸으므로 통과, 링크 하나만으로는 통과(광고 문구와 함께면 hold)
  const hold = flags.some((f) => f.code === "collusion" || f.code === "ad" || f.code === "abuse" || (f.code === "privacy" && f.label === "주민등록번호"));
  return { text, flags, action: hold ? "hold" : "pass" };
}

/** 본문 미리보기(줄바꿈 정리) */
export function excerpt(body: string, n = 120): string {
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 시군구 코드(5자리) */
export function isSgg(v: unknown): v is string {
  return typeof v === "string" && /^\d{5}$/.test(v);
}

/** 거주 인증: 단지 좌표에서 이 거리 안, 서로 다른 날 이만큼 확인하면 인증. 인증은 이 기간 유지 */
export const RESIDENCE = { radiusM: 250, days: 3, windowDays: 30, validDays: 365 } as const;

/** 거주 인증 확인 기록 갱신(순수). 같은 날은 한 번만, 창 밖 기록은 버린다 */
export function addResidenceCheck(checks: { day: string; dist: number }[], day: string, dist: number) {
  const since = new Date(new Date(`${day}T00:00:00Z`).getTime() - RESIDENCE.windowDays * 86400_000).toISOString().slice(0, 10);
  const kept = checks.filter((c) => c.day >= since && c.day !== day);
  const next = dist <= RESIDENCE.radiusM ? [...kept, { day, dist: Math.round(dist) }] : kept;
  next.sort((a, b) => a.day.localeCompare(b.day));
  return { checks: next, verified: next.length >= RESIDENCE.days, inRange: dist <= RESIDENCE.radiusM };
}
