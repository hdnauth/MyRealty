import "server-only";

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/**
 * 공공데이터포털 키: Encoding 키(%2B·%2F·%3D 포함)를 넣었으면 Decoding 키로 바꾼다.
 * URLSearchParams 가 % 를 다시 인코딩(%252F)해 '등록되지 않은 서비스키'가 되기 때문(ETL config._service_key 와 같은 처리).
 */
function serviceKey(name: string): string | undefined {
  const v = opt(name)?.trim().replace(/^["']|["']$/g, "");
  if (!v) return undefined;
  if (!v.includes("%")) return v;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function emailList(name: string): string[] {
  return (opt(name) ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const env = {
  databaseUrl: opt("DATABASE_URL") ?? "postgresql://myrealty:myrealty@localhost:5432/myrealty",
  authSecret: opt("AUTH_SECRET") ?? (process.env.NODE_ENV === "production" ? undefined : "dev-only-insecure-secret-change-me"),
  /** 관리자 계정(쉼표 구분). 관리 화면 접근, 가입 정책과 무관하게 로그인 가능, 화면에서 해제·정지 불가 */
  adminEmails: emailList("ADMIN_EMAILS"),
  /** 가입 방식이 "허용 목록"일 때 추가로 허용할 이메일 */
  allowedEmails: emailList("ALLOWED_EMAILS"),
  smtp: {
    host: opt("SMTP_HOST"),
    port: Number(opt("SMTP_PORT") ?? 587),
    user: opt("SMTP_USER"),
    password: opt("SMTP_PASSWORD"),
    from: opt("MAIL_FROM") ?? "MyRealty <no-reply@example.com>",
  },
  jusoKey: opt("JUSO_KEY"),
  /** 공공데이터포털 일반 인증키(Decoding) — 부동산 등록 시 건축물대장(용도·동·호·면적) 조회 */
  dataGoKrKey: serviceKey("DATA_GO_KR_KEY"),
  quotaDataGoKr: Number(opt("QUOTA_DATA_GO_KR") ?? 900),
  /** 브이월드 — 부동산 등록 시 토지특성(지목·면적), 지오코딩 보조, 대체 지도 배경 */
  vworldKey: opt("VWORLD_KEY"),
  vworldDomain: opt("VWORLD_DOMAIN"),
  ncpKeyId: opt("NCP_MAPS_KEY_ID"),
  ncpKey: opt("NCP_MAPS_KEY"),
  anthropicApiKey: opt("ANTHROPIC_API_KEY"),
  anthropicModel: opt("ANTHROPIC_MODEL") ?? "claude-opus-5",
  vapidPublicKey: opt("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
  vapidPrivateKey: opt("VAPID_PRIVATE_KEY"),
  vapidSubject: opt("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  appUrl: opt("APP_URL") ?? "http://localhost:3000",
  /**
   * 앱 마켓 심사용 계정: 이 이메일은 메일을 보내지 않고 고정 6자리 코드로 로그인한다(심사자가 메일을 받을 수 없어서).
   * 둘 다 있어야 켜진다. 관리자가 아닌 전용 계정을 쓰고, 심사가 끝나면 비운다.
   */
  reviewLogin: {
    email: opt("REVIEW_LOGIN_EMAIL")?.trim().toLowerCase(),
    code: /^\d{6}$/.test(opt("REVIEW_LOGIN_CODE") ?? "") ? opt("REVIEW_LOGIN_CODE") : undefined,
  },
  /** Android 앱(TWA) Digital Asset Links: 패키지명, 서명 인증서 SHA-256(쉼표 구분 — 업로드 키·Play 앱 서명 키) */
  androidPackage: opt("ANDROID_PACKAGE_NAME") ?? "com.yarch.myrealty",
  androidCertFingerprints: (opt("ANDROID_CERT_SHA256") ?? "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
  /** 개인정보처리방침·탈퇴 안내에 표시할 문의 이메일(없으면 ADMIN_EMAILS 첫 번째) */
  supportEmail: opt("SUPPORT_EMAIL") ?? emailList("ADMIN_EMAILS")[0],
  /** 개인정보처리방침의 운영자(개인정보 보호책임자) 이름. 스토어 등록 개발자 이름과 맞춘다 */
  operatorName: opt("OPERATOR_NAME") ?? "마이리얼티 운영자",
  /**
   * 관심 부동산 개별 수집(등록 직후 바로 채우기). GitHub Actions 의 etl-item.yml 을 workflow_dispatch 로 실행한다.
   * 토큰: 이 리포 한정 fine-grained PAT, 권한 Actions: Read and write
   */
  githubDispatchToken: opt("GITHUB_DISPATCH_TOKEN"),
  /** owner/repo */
  githubDispatchRepo: opt("GITHUB_DISPATCH_REPO"),
  githubDispatchRef: opt("GITHUB_DISPATCH_REF") ?? "main",
  /** 로컬 개발: 1 이면 GitHub 대신 services/etl 에서 `uv run myrealty item` 을 직접 띄운다 */
  itemCollectLocal: opt("ITEM_COLLECT_LOCAL") === "1",
  isDev: process.env.NODE_ENV !== "production",
};

export function requireAuthSecret(): Uint8Array {
  if (!env.authSecret) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  return new TextEncoder().encode(env.authSecret);
}
