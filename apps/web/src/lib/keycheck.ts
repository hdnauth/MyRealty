import "server-only";
import { createECDH, createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { sql } from "./db";
import { env } from "./env";

/*
 * 웹(Vercel 등 배포 환경)에 넣은 키 점검. live=false 면 설정 여부만, true 면 각 키로 가벼운 요청을 한 번씩 보내
 * 인증 오류·활용신청 누락·모델명 오타 등을 원인별로 알려 준다. 값은 내보내지 않고 지문(SHA-256 앞 8자리)만 보여 줘
 * GitHub Actions 의 `myrealty doctor` 결과(같은 방식의 지문)와 같은 키인지 비교할 수 있다.
 */

export type KeyStatus = "ok" | "missing" | "optional" | "warn" | "error" | "unchecked";
export type KeyCheck = { key: string; label: string; status: KeyStatus; detail: string; fix?: string; fp?: string | null };

export function fingerprint(v: string | undefined | null) {
  return v ? createHash("sha256").update(v).digest("hex").slice(0, 8) : null;
}

/** DATABASE_URL 의 호스트:포트/DB 지문(사용자·비밀번호 제외) — ETL 과 같은 DB 를 보는지 비교용 */
export function dbFingerprint(url: string | undefined | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return fingerprint(`${u.hostname.toLowerCase()}:${u.port || 5432}/${u.pathname.replace(/^\//, "") || "postgres"}`);
  } catch {
    return null;
  }
}

const SECRET_NAMES = [
  "DATA_GO_KR_KEY", "VWORLD_KEY", "JUSO_KEY", "NCP_MAPS_KEY_ID", "NCP_MAPS_KEY", "ANTHROPIC_API_KEY", "SMTP_PASSWORD",
  "VAPID_PRIVATE_KEY", "CRON_SECRET", "AUTH_SECRET", "DATABASE_URL", "GITHUB_DISPATCH_TOKEN",
];
function sanitize(msg: string) {
  let s = msg;
  for (const n of SECRET_NAMES) {
    const v = process.env[n];
    if (v && v.length >= 6) s = s.split(v).join("***");
  }
  return s.slice(0, 300);
}
const errMsg = (e: unknown) => sanitize(e instanceof Error ? `${e.name === "TimeoutError" ? "시간 초과" : e.message}` : String(e));

async function get(url: string, init?: RequestInit) {
  return fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000), ...init });
}

const DATA_GO_KR_FIX: Record<string, string> = {
  "20": "공공데이터포털에서 '건축HUB 건축물대장정보 서비스' 활용신청이 안 됐거나 승인 대기 중입니다.",
  "22": "오늘 호출 한도를 넘었습니다.",
  "30": "등록되지 않은 키입니다. 일반 인증키 중 Decoding 키인지, 승인 후 1~2시간 지났는지 확인하세요.",
  "31": "키 사용 기간이 끝났습니다(활용신청 연장).",
  "32": "등록되지 않은 IP 입니다(활용신청의 IP 제한 해제).",
};

type Checker = (live: boolean) => Promise<KeyCheck | KeyCheck[]>;

const checks: Checker[] = [
  async () => {
    const s = env.authSecret;
    if (!process.env.AUTH_SECRET)
      return { key: "AUTH_SECRET", label: "세션 서명", status: env.isDev ? "warn" : "missing", detail: env.isDev ? "개발용 기본값 사용 중" : "로그인할 수 없습니다.", fix: "openssl rand -base64 32 결과를 넣으세요." };
    return s && s.length < 32
      ? { key: "AUTH_SECRET", label: "세션 서명", status: "warn", detail: `너무 짧습니다(${s.length}자).`, fix: "32자 이상 무작위 값 권장(openssl rand -base64 32)." }
      : { key: "AUTH_SECRET", label: "세션 서명", status: "ok", detail: "설정됨(웹 전용)" };
  },
  async () => {
    const fp = dbFingerprint(process.env.DATABASE_URL);
    try {
      await sql`select 1`;
      return { key: "DATABASE_URL", label: "데이터베이스", status: "ok", detail: "연결 정상", fp };
    } catch (e) {
      return { key: "DATABASE_URL", label: "데이터베이스", status: "error", detail: errMsg(e), fix: "주소·비밀번호 확인. Vercel 은 Transaction pooler(6543) 주소", fp };
    }
  },
  async () =>
    env.adminEmails.length
      ? { key: "ADMIN_EMAILS", label: "관리자 계정", status: "ok", detail: `${env.adminEmails.length}명` }
      : { key: "ADMIN_EMAILS", label: "관리자 계정", status: "warn", detail: "없음", fix: "관리자 이메일을 쉼표로 구분해 넣으세요." },
  async (live) => {
    const { host, port, user, password } = env.smtp;
    if (!host)
      return { key: "SMTP_HOST", label: "메일(SMTP)", status: env.isDev ? "optional" : "missing", detail: env.isDev ? "로그인 코드가 서버 로그에 출력됩니다." : "로그인 코드 메일을 보낼 수 없습니다.", fix: "SMTP_HOST/PORT/USER/PASSWORD, MAIL_FROM" };
    if (!live) return { key: "SMTP_HOST", label: "메일(SMTP)", status: "unchecked", detail: `${host}:${port}`, fp: fingerprint(user) };
    try {
      await nodemailer
        .createTransport({ host, port, secure: port === 465, auth: user ? { user, pass: password } : undefined, connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 8_000 })
        .verify();
      return { key: "SMTP_HOST", label: "메일(SMTP)", status: "ok", detail: `${host}:${port} 로그인 성공`, fp: fingerprint(user) };
    } catch (e) {
      const auth = /auth|login|credentials|535/i.test(String(e));
      return { key: "SMTP_HOST", label: "메일(SMTP)", status: "error", detail: errMsg(e), fix: auth ? "SMTP_USER/SMTP_PASSWORD 확인(Gmail 은 앱 비밀번호)" : "호스트·포트(587 STARTTLS / 465 SSL) 확인", fp: fingerprint(user) };
    }
  },
  async (live) => {
    const key = env.jusoKey;
    if (!key) return { key: "JUSO_KEY", label: "도로명주소 검색", status: "optional", detail: "부동산 등록 시 수집된 단지명만 검색됩니다.", fix: "business.juso.go.kr 에서 '도로명주소 검색 API' 승인키 발급" };
    if (!live) return { key: "JUSO_KEY", label: "도로명주소 검색", status: "unchecked", detail: "설정됨", fp: fingerprint(key) };
    try {
      const q = new URLSearchParams({ confmKey: key, currentPage: "1", countPerPage: "1", keyword: "세종대로 110", resultType: "json" });
      const c = (await (await get(`https://business.juso.go.kr/addrlink/addrLinkApi.do?${q}`)).json())?.results?.common;
      if (c?.errorCode === "0") return { key: "JUSO_KEY", label: "도로명주소 검색", status: "ok", detail: "검색 응답 정상", fp: fingerprint(key) };
      return { key: "JUSO_KEY", label: "도로명주소 검색", status: "error", detail: `${c?.errorCode} ${c?.errorMessage ?? ""}`, fix: "승인키·사용 기간(개발키는 90일)을 확인하세요.", fp: fingerprint(key) };
    } catch (e) {
      return { key: "JUSO_KEY", label: "도로명주소 검색", status: "error", detail: errMsg(e), fp: fingerprint(key) };
    }
  },
  async (live) => {
    const id = env.ncpKeyId;
    const secret = env.ncpKey;
    const label = "네이버 지도·지오코딩";
    const mapNote = "지도 표시는 브라우저에서 인증하므로 지도 화면에서 확인(실패하면 원인 안내 후 대체 지도 표시)";
    if (!id) return { key: "NCP_MAPS_KEY_ID", label, status: "optional", detail: "대체 지도(브이월드/OSM)로 표시합니다.", fix: "NCP 콘솔 → Maps → Application(Dynamic Map·Geocoding 선택)의 Client ID/Secret" };
    if (!secret) return { key: "NCP_MAPS_KEY_ID", label, status: "warn", detail: `NCP_MAPS_KEY(Client Secret)가 없어 지오코딩을 못 합니다. ${mapNote}`, fp: fingerprint(id) };
    if (!live) return { key: "NCP_MAPS_KEY_ID", label, status: "unchecked", detail: mapNote, fp: fingerprint(id) };
    try {
      const r = await get(`https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent("분당구 불정로 6")}`, {
        headers: { "x-ncp-apigw-api-key-id": id, "x-ncp-apigw-api-key": secret },
      });
      if (r.ok) return { key: "NCP_MAPS_KEY_ID", label, status: "ok", detail: `지오코딩 정상. ${mapNote}`, fp: fingerprint(id) };
      return {
        key: "NCP_MAPS_KEY_ID",
        label,
        status: "error",
        detail: sanitize(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`),
        fix: r.status === 401 ? "Client ID/Secret 이 맞는지 확인하세요." : "Application 설정에서 Geocoding 을 선택했는지 확인하세요.",
        fp: fingerprint(id),
      };
    } catch (e) {
      return { key: "NCP_MAPS_KEY_ID", label, status: "error", detail: errMsg(e), fp: fingerprint(id) };
    }
  },
  async (live) => {
    const key = env.dataGoKrKey;
    const label = "공공데이터포털(건축물대장)";
    if (!key) return { key: "DATA_GO_KR_KEY", label, status: "optional", detail: "부동산 등록 시 용도·평형·동·호를 자동으로 채우지 못합니다(ETL 에는 필수).", fix: "Vercel 에도 GitHub 와 같은 DATA_GO_KR_KEY 를 넣으세요." };
    if (!live) return { key: "DATA_GO_KR_KEY", label, status: "unchecked", detail: "설정됨", fp: fingerprint(key) };
    try {
      const q = new URLSearchParams({ serviceKey: key, sigunguCd: "11110", bjdongCd: "10100", platGbCd: "0", bun: "0001", ji: "0000", _type: "json", numOfRows: "1", pageNo: "1" });
      const text = await (await get(`https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?${q}`)).text();
      let code = "?";
      let msg = text.slice(0, 120);
      try {
        const h = JSON.parse(text)?.response?.header;
        code = String(h?.resultCode);
        msg = h?.resultMsg ?? "";
      } catch {
        code = text.match(/<returnReasonCode>(\d+)</)?.[1] ?? (/SERVICE_KEY_IS_NOT_REGISTERED/.test(text) ? "30" : "?");
        msg = text.match(/<returnAuthMsg>([^<]+)</)?.[1] ?? msg;
      }
      if (code === "00" || code === "000") return { key: "DATA_GO_KR_KEY", label, status: "ok", detail: "건축물대장 응답 정상", fp: fingerprint(key) };
      return { key: "DATA_GO_KR_KEY", label, status: "error", detail: sanitize(`오류 ${code}: ${msg}`), fix: DATA_GO_KR_FIX[code] ?? "키와 활용신청 상태를 확인하세요.", fp: fingerprint(key) };
    } catch (e) {
      return { key: "DATA_GO_KR_KEY", label, status: "error", detail: errMsg(e), fp: fingerprint(key) };
    }
  },
  async (live) => {
    const key = env.vworldKey;
    if (!key) return { key: "VWORLD_KEY", label: "브이월드", status: "optional", detail: "토지 지목·면적 자동 입력, 대체 지도 배경(OSM 사용), 좌표 보조가 없습니다.", fix: "vworld.kr 인증키(서비스 URL 에 배포 도메인 등록)" };
    if (!live) return { key: "VWORLD_KEY", label: "브이월드", status: "unchecked", detail: "설정됨", fp: fingerprint(key) };
    try {
      const q = new URLSearchParams({ service: "address", request: "getcoord", version: "2.0", crs: "epsg:4326", address: "서울특별시 중구 세종대로 110", type: "ROAD", format: "json", key });
      if (env.vworldDomain) q.set("domain", env.vworldDomain);
      const resp = (await (await get(`https://api.vworld.kr/req/address?${q}`)).json())?.response;
      if (resp?.status === "OK" || resp?.status === "NOT_FOUND") return { key: "VWORLD_KEY", label: "브이월드", status: "ok", detail: "주소 좌표 변환 정상", fp: fingerprint(key) };
      return { key: "VWORLD_KEY", label: "브이월드", status: "error", detail: sanitize(`${resp?.error?.code ?? ""} ${resp?.error?.text ?? ""}`.trim() || "응답 오류"), fix: "키, 키에 등록한 서비스 URL 과 VWORLD_DOMAIN 이 같은지 확인하세요.", fp: fingerprint(key) };
    } catch (e) {
      return { key: "VWORLD_KEY", label: "브이월드", status: "error", detail: errMsg(e), fp: fingerprint(key) };
    }
  },
  async (live) => {
    const key = env.anthropicApiKey;
    if (!key) return { key: "ANTHROPIC_API_KEY", label: "Claude API", status: "optional", detail: "AI 질문·분석·리포트가 꺼집니다.", fix: "console.anthropic.com 에서 API 키 발급" };
    if (!live) return { key: "ANTHROPIC_API_KEY", label: "Claude API", status: "unchecked", detail: `모델 ${env.anthropicModel}`, fp: fingerprint(key) };
    try {
      const r = await get(`https://api.anthropic.com/v1/models/${encodeURIComponent(env.anthropicModel)}`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
      if (r.ok) return { key: "ANTHROPIC_API_KEY", label: "Claude API", status: "ok", detail: `키·모델 확인(${env.anthropicModel})`, fp: fingerprint(key) };
      if (r.status === 404)
        return [
          { key: "ANTHROPIC_API_KEY", label: "Claude API", status: "ok", detail: "키 정상", fp: fingerprint(key) },
          { key: "ANTHROPIC_MODEL", label: "Claude 모델", status: "error", detail: `'${env.anthropicModel}' 모델을 찾을 수 없습니다.`, fix: "ANTHROPIC_MODEL 값을 확인하세요(비우면 기본값)." },
        ];
      return { key: "ANTHROPIC_API_KEY", label: "Claude API", status: "error", detail: r.status === 401 ? "API 키 인증 실패(401)" : `HTTP ${r.status}`, fix: "키를 다시 발급해 넣으세요.", fp: fingerprint(key) };
    } catch (e) {
      return { key: "ANTHROPIC_API_KEY", label: "Claude API", status: "error", detail: errMsg(e), fp: fingerprint(key) };
    }
  },
  async () => {
    const pub = env.vapidPublicKey;
    const priv = env.vapidPrivateKey;
    const label = "웹푸시(VAPID)";
    if (!pub && !priv) return { key: "VAPID_PRIVATE_KEY", label, status: "optional", detail: "푸시 없이 메일로만 알립니다.", fix: "npx web-push generate-vapid-keys" };
    if (!pub || !priv) return { key: "VAPID_PRIVATE_KEY", label, status: "error", detail: "공개키·비밀키 중 하나만 있습니다.", fix: "NEXT_PUBLIC_VAPID_PUBLIC_KEY 와 VAPID_PRIVATE_KEY 를 한 쌍으로", fp: fingerprint(pub) };
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(Buffer.from(priv, "base64url"));
      if (!ecdh.getPublicKey().equals(Buffer.from(pub, "base64url")))
        return { key: "VAPID_PRIVATE_KEY", label, status: "error", detail: "공개키와 비밀키가 한 쌍이 아닙니다.", fix: "같은 generate-vapid-keys 결과의 두 값을 함께 넣으세요.", fp: fingerprint(pub) };
    } catch {
      return { key: "VAPID_PRIVATE_KEY", label, status: "error", detail: "키 형식 오류", fix: "base64url 형식인지 확인하세요.", fp: fingerprint(pub) };
    }
    // NEXT_PUBLIC_ 값은 빌드 때 화면 코드에 박힌다 → 나중에 바꿨다면 재배포해야 브라우저가 새 키를 쓴다
    const built = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (built !== undefined && built !== pub)
      return { key: "VAPID_PRIVATE_KEY", label, status: "warn", detail: "빌드에 들어간 공개키와 현재 값이 다릅니다.", fix: "환경 변수를 바꾼 뒤 재배포하세요.", fp: fingerprint(pub) };
    return { key: "VAPID_PRIVATE_KEY", label, status: "ok", detail: "공개키·비밀키 한 쌍 확인", fp: fingerprint(pub) };
  },
  // 관심 부동산 개별 수집(등록 직후 바로 채우기): GitHub Actions etl-item.yml 을 부를 수 있는지
  async (live: boolean): Promise<KeyCheck> => {
    const key = "GITHUB_DISPATCH_TOKEN";
    const label = "개별 수집(등록 직후 바로 채우기)";
    if (!env.githubDispatchToken || !env.githubDispatchRepo) {
      return env.itemCollectLocal
        ? { key, label, status: "ok", detail: "로컬 ETL 로 실행(ITEM_COLLECT_LOCAL=1)" }
        : { key, label, status: "optional", detail: "새 부동산 데이터가 다음 날 아침 수집 때 채워집니다.", fix: "GITHUB_DISPATCH_TOKEN(이 리포 Actions: Read and write 권한 fine-grained 토큰)과 GITHUB_DISPATCH_REPO(owner/repo)를 넣으세요." };
    }
    const fp = fingerprint(env.githubDispatchToken);
    if (!live) return { key, label, status: "unchecked", detail: `${env.githubDispatchRepo} · etl-item.yml`, fp };
    const res = await fetch(`https://api.github.com/repos/${env.githubDispatchRepo}/actions/workflows/etl-item.yml`, {
      headers: { Authorization: `Bearer ${env.githubDispatchToken}`, Accept: "application/vnd.github+json", "User-Agent": "MyRealty" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) return { key, label, status: "ok", detail: `${env.githubDispatchRepo} · etl-item.yml 확인(실행 권한은 첫 등록 때 확인됩니다)`, fp };
    const why = res.status === 401 ? "토큰이 틀렸거나 만료됐습니다." : res.status === 404 ? "리포지토리나 워크플로(etl-item.yml)를 찾을 수 없습니다(토큰의 리포 접근 권한·main 에 워크플로가 있는지 확인)." : `GitHub HTTP ${res.status}`;
    return { key, label, status: "error", detail: why, fix: "fine-grained 토큰에 이 리포 · Actions: Read and write 권한을 주세요.", fp };
  },
  async () =>
    process.env.CRON_SECRET
      ? { key: "CRON_SECRET", label: "정기 리포트 호출 인증", status: "ok", detail: "설정됨 — GitHub 과 같은 값인지는 Check keys 워크플로가 직접 호출해 확인", fp: fingerprint(process.env.CRON_SECRET) }
      : { key: "CRON_SECRET", label: "정기 리포트 호출 인증", status: "optional", detail: "정기 리포트 자동 생성 불가(수동 생성은 가능)", fix: "Vercel 과 GitHub Secrets 에 같은 무작위 값" },
];

export async function runKeyChecks(live: boolean, origin?: string | null): Promise<KeyCheck[]> {
  const out = (await Promise.all(checks.map((c) => c(live).catch((e) => ({ key: "?", label: "점검 오류", status: "error" as const, detail: errMsg(e) }))))).flat();
  // APP_URL: 메일 링크·GitHub 리포트 호출이 이 주소로 간다
  const app = env.appUrl.replace(/\/$/, "");
  out.splice(3, 0,
    origin && app !== origin
      ? { key: "APP_URL", label: "앱 주소", status: "warn", detail: `APP_URL(${app})이 지금 주소(${origin})와 다릅니다.`, fix: "배포 주소로 맞추세요(GitHub Variables 의 APP_URL 도)." }
      : { key: "APP_URL", label: "앱 주소", status: "ok", detail: app },
  );
  return out;
}

/** GitHub Actions(ETL) 에서 마지막으로 돈 myrealty doctor 결과 */
export async function lastDoctorRun() {
  const [row] = await sql<{ started_at: string; status: string; detail: { checks: KeyCheck[]; source?: string; run_url?: string | null } | null }[]>`
    select started_at::text, status, detail from job_runs where job = 'doctor' order by started_at desc limit 1`;
  return row ?? null;
}
