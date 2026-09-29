"""키·설정 점검(myrealty doctor): GitHub Actions(ETL)에 넣은 환경 변수가 비었는지, 실제로 동작하는지 확인한다.

- 각 키로 가장 가벼운 요청을 한 번씩 보내 인증 오류·활용신청 누락·모델명 오타 등을 원인별로 알려 준다.
- 값은 출력하지 않는다. 대신 지문(SHA-256 앞 8자리)을 보여 줘 웹(Vercel) 관리 화면의 지문과 같은 키인지 비교할 수 있다.
- APP_URL·CRON_SECRET 이 있으면 웹 앱을 직접 호출해 두 곳의 CRON_SECRET 이 같은지까지 확인한다.
- 결과는 job_runs(job='doctor')에 저장돼 관리 → 시스템 화면에 보이고, Actions 에서는 실행 요약(Step Summary)에 표로 나온다.
"""

from __future__ import annotations

import base64
import hashlib
import os
import smtplib
import ssl
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import date
from urllib.parse import urlparse

import httpx

from .collectors import rtms
from .config import settings

TIMEOUT = httpx.Timeout(12.0, connect=8.0)


@dataclass
class Check:
    key: str
    label: str
    status: str  # ok | missing | optional | warn | error
    detail: str = ""
    fix: str = ""
    fp: str | None = None


def fingerprint(value: str | None) -> str | None:
    return hashlib.sha256(value.encode()).hexdigest()[:8] if value else None


def db_fingerprint(url: str | None) -> str | None:
    """DATABASE_URL 의 호스트:포트/DB 이름 지문(비밀번호·사용자 제외) — 웹과 같은 DB 를 보는지 비교용."""
    if not url:
        return None
    u = urlparse(url)
    return fingerprint(f"{(u.hostname or '').lower()}:{u.port or 5432}/{u.path.lstrip('/') or 'postgres'}")


def b64urldecode(s: str) -> bytes:
    s = s.strip()
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _secrets() -> list[str]:
    names = ["DATA_GO_KR_KEY", "VWORLD_KEY", "ECOS_KEY", "KOSIS_KEY", "REB_KEY", "NCP_MAPS_KEY_ID", "NCP_MAPS_KEY",
             "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET", "ANTHROPIC_API_KEY", "SMTP_PASSWORD", "VAPID_PRIVATE_KEY",
             "CRON_SECRET", "DATABASE_URL"]
    return [v for v in (os.environ.get(n) for n in names) if v and len(v) >= 6]


def sanitize(msg: str) -> str:
    """오류 메시지에 섞인 키 값(URL 쿼리 등)을 가린다."""
    for s in _secrets():
        msg = msg.replace(s, "***")
    return msg[:300]


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers={"User-Agent": "MyRealty-doctor/0.1"})


# data.go.kr 공통 오류 코드 → 조치
DATA_GO_KR_FIX = {
    "20": "공공데이터포털에서 이 서비스 활용신청이 안 됐거나 승인 대기 중입니다(마이페이지 → 활용신청 현황).",
    "22": "오늘 호출 한도를 넘었습니다. 내일 다시 확인하거나 운영계정으로 전환하세요.",
    "30": "등록되지 않은 키입니다. 일반 인증키(Decoding)를 넣었는지, 승인 후 1~2시간이 지났는지 확인하세요. 웹(Vercel)에서는 되는데 여기서만 실패하면 아래 '국내 API 중계'가 정상인지 보세요(정상이면 수집은 웹을 거쳐 됩니다).",
    "31": "키 사용 기간이 끝났습니다. 활용신청 기간을 연장하세요.",
    "32": "등록되지 않은 IP 입니다. 활용신청의 IP 제한을 해제하세요.",
}


def _data_go_kr_error(msg: str) -> Check:
    code = next((c for c in DATA_GO_KR_FIX if f"오류 {c}" in msg or f" {c}:" in msg), None)
    if "SERVICE_KEY_IS_NOT_REGISTERED" in msg:
        code = "30"
    return Check("DATA_GO_KR_KEY", "공공데이터포털", "error", sanitize(msg), DATA_GO_KR_FIX.get(code or "", "키와 활용신청 상태를 확인하세요."),
                 fingerprint(settings.data_go_kr_key))


def check_data_go_kr(c: httpx.Client) -> Check:
    key = settings.data_go_kr_key
    fp = fingerprint(key)
    if not key:
        return Check("DATA_GO_KR_KEY", "공공데이터포털", "missing", "실거래·건축물대장·청약 수집을 건너뜁니다.",
                     "data.go.kr 일반 인증키(Decoding)를 GitHub Secrets 에 DATA_GO_KR_KEY 로 넣으세요.")
    today = date.today()
    ym = f"{today.year - (today.month == 1)}{(today.month - 2) % 12 + 1:02d}"
    svc = rtms.SERVICES[0]
    try:
        r = c.get(f"{rtms.BASE}/{svc.path}", params={"serviceKey": key, "LAWD_CD": "11110", "DEAL_YMD": ym, "numOfRows": 1, "pageNo": 1})
        rtms.parse_xml(r.text)
    except Exception as e:
        ck = _data_go_kr_error(f"실거래가(아파트 매매): {e}")
        return ck
    # 건축물대장(웹 등록 화면·ETL attrs 가 사용) — 서비스별로 활용신청이 따로라 별도 확인
    try:
        r = c.get("https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo", params={
            "serviceKey": key, "sigunguCd": "11110", "bjdongCd": "10100", "platGbCd": "0", "bun": "0001", "ji": "0000",
            "_type": "json", "numOfRows": 1, "pageNo": 1})
        try:
            header = r.json()["response"]["header"]
            code, msg = str(header.get("resultCode")), header.get("resultMsg", "")
        except Exception:
            code, msg = "30" if "SERVICE_KEY" in r.text else "?", r.text[:120]
        if code not in ("00", "000"):
            ck = _data_go_kr_error(f"건축물대장: 오류 {code}: {msg}")
            ck.status = "warn"
            ck.detail = "실거래가는 정상, " + ck.detail
            return ck
    except httpx.HTTPError as e:
        return Check("DATA_GO_KR_KEY", "공공데이터포털", "warn", sanitize(f"실거래가 정상, 건축물대장 확인 실패: {e}"), fp=fp)
    return Check("DATA_GO_KR_KEY", "공공데이터포털", "ok", "실거래가·건축물대장 응답 정상", fp=fp)


def check_vworld(c: httpx.Client) -> Check:
    key = settings.vworld_key
    if not key:
        return Check("VWORLD_KEY", "브이월드", "optional", "토지특성·이용계획·공시가격 수집을 건너뜁니다.",
                     "vworld.kr 에서 인증키를 발급해 VWORLD_KEY 로 넣으세요(서비스 URL 을 등록했다면 VWORLD_DOMAIN 도).")
    params = {"service": "address", "request": "getcoord", "version": "2.0", "crs": "epsg:4326", "address": "서울특별시 중구 세종대로 110",
              "type": "ROAD", "format": "json", "key": key}
    if settings.vworld_domain:
        params["domain"] = settings.vworld_domain
    try:
        resp = c.get("https://api.vworld.kr/req/address", params=params).json().get("response", {})
    except Exception as e:
        return Check("VWORLD_KEY", "브이월드", "error", sanitize(str(e)), fp=fingerprint(key))
    if resp.get("status") in ("OK", "NOT_FOUND"):
        return Check("VWORLD_KEY", "브이월드", "ok", "주소 좌표 변환 응답 정상", fp=fingerprint(key))
    err = resp.get("error") or {}
    return Check("VWORLD_KEY", "브이월드", "error", sanitize(f"{err.get('code', '')} {err.get('text', '')}".strip() or str(resp)[:200]),
                 "키가 맞는지, 키에 등록한 서비스 URL 과 VWORLD_DOMAIN 이 같은지 확인하세요.", fingerprint(key))


def check_ecos(c: httpx.Client) -> Check:
    key = settings.ecos_key
    if not key:
        return Check("ECOS_KEY", "한국은행 ECOS", "optional", "금리·물가·M2 없이 지표를 계산합니다.", "ecos.bok.or.kr 에서 인증키 신청")
    try:
        data = c.get(f"https://ecos.bok.or.kr/api/KeyStatisticList/{key}/json/kr/1/1").json()
    except Exception as e:
        return Check("ECOS_KEY", "한국은행 ECOS", "error", sanitize(str(e)), fp=fingerprint(key))
    if "KeyStatisticList" in data:
        return Check("ECOS_KEY", "한국은행 ECOS", "ok", "응답 정상", fp=fingerprint(key))
    res = data.get("RESULT") or {}
    return Check("ECOS_KEY", "한국은행 ECOS", "error", f"{res.get('CODE', '')} {res.get('MESSAGE', '')}".strip(), "인증키를 다시 확인하세요.",
                 fingerprint(key))


def check_kosis(c: httpx.Client) -> Check:
    key = settings.kosis_key
    if not key:
        return Check("KOSIS_KEY", "KOSIS", "optional", "미분양 통계를 건너뜁니다.", "kosis.kr/openapi 에서 인증키 신청")
    try:
        data = c.get("https://kosis.kr/openapi/statisticsList.do", params={
            "method": "getList", "apiKey": key, "vwCd": "MT_ZTITLE", "parentListId": "", "format": "json", "jsonVD": "Y"}).json()
    except Exception as e:
        return Check("KOSIS_KEY", "KOSIS", "error", sanitize(str(e)), fp=fingerprint(key))
    if isinstance(data, list):
        return Check("KOSIS_KEY", "KOSIS", "ok", "응답 정상", fp=fingerprint(key))
    return Check("KOSIS_KEY", "KOSIS", "error", f"{data.get('err', '')} {data.get('errMsg', '')}".strip(), "인증키를 다시 확인하세요.",
                 fingerprint(key))


def check_reb(c: httpx.Client) -> Check:
    key = settings.reb_key
    if not key:
        return Check("REB_KEY", "한국부동산원 R-ONE", "optional", "부동산원 지수를 건너뜁니다.", "reb.or.kr/r-one 에서 인증키 신청")
    try:
        data = c.get("https://www.reb.or.kr/r-one/openapi/SttsApiTbl.do", params={"KEY": key, "Type": "json", "pIndex": 1, "pSize": 1}).json()
    except Exception as e:
        return Check("REB_KEY", "한국부동산원 R-ONE", "error", sanitize(str(e)), fp=fingerprint(key))
    if data.get("SttsApiTbl"):
        return Check("REB_KEY", "한국부동산원 R-ONE", "ok", "응답 정상", fp=fingerprint(key))
    res = data.get("RESULT") or {}
    return Check("REB_KEY", "한국부동산원 R-ONE", "error", f"{res.get('CODE', '')} {res.get('MESSAGE', '')}".strip() or str(data)[:200],
                 "인증키를 다시 확인하세요.", fingerprint(key))


def check_ncp(c: httpx.Client) -> Check:
    kid, key = settings.ncp_key_id, settings.ncp_key
    if not kid and not key:
        return Check("NCP_MAPS_KEY_ID", "네이버 클라우드 지오코딩", "optional", "좌표는 브이월드로 보조합니다.",
                     "NCP 콘솔 → Maps → Application 에서 Geocoding 을 선택한 Client ID/Secret 을 넣으세요.")
    if not (kid and key):
        return Check("NCP_MAPS_KEY_ID", "네이버 클라우드 지오코딩", "warn", "NCP_MAPS_KEY_ID 와 NCP_MAPS_KEY 중 하나만 있습니다.",
                     "지오코딩에는 Client ID(NCP_MAPS_KEY_ID)와 Client Secret(NCP_MAPS_KEY)이 모두 필요합니다.", fingerprint(kid))
    try:
        r = c.get("https://maps.apigw.ntruss.com/map-geocode/v2/geocode", params={"query": "분당구 불정로 6"},
                  headers={"x-ncp-apigw-api-key-id": kid, "x-ncp-apigw-api-key": key})
    except httpx.HTTPError as e:
        return Check("NCP_MAPS_KEY_ID", "네이버 클라우드 지오코딩", "error", sanitize(str(e)), fp=fingerprint(kid))
    if r.status_code == 200:
        return Check("NCP_MAPS_KEY_ID", "네이버 클라우드 지오코딩", "ok", "지오코딩 응답 정상", fp=fingerprint(kid))
    fix = ("Client ID/Secret 이 맞는지 확인하세요." if r.status_code == 401
           else "Maps Application 설정에서 Geocoding API 를 선택했는지 확인하세요." if r.status_code in (403, 429)
           else "")
    return Check("NCP_MAPS_KEY_ID", "네이버 클라우드 지오코딩", "error", sanitize(f"HTTP {r.status_code} {r.text[:150]}"), fix, fingerprint(kid))


def check_naver_search(c: httpx.Client) -> Check:
    cid, sec = settings.naver_client_id, settings.naver_client_secret
    if not cid and not sec:
        return Check("NAVER_CLIENT_ID", "네이버 검색(뉴스)", "optional", "뉴스 수집을 건너뜁니다.",
                     "developers.naver.com 에서 검색 API 애플리케이션을 만들어 Client ID/Secret 을 넣으세요.")
    try:
        r = c.get("https://openapi.naver.com/v1/search/news.json", params={"query": "부동산", "display": 1},
                  headers={"X-Naver-Client-Id": cid or "", "X-Naver-Client-Secret": sec or ""})
    except httpx.HTTPError as e:
        return Check("NAVER_CLIENT_ID", "네이버 검색(뉴스)", "error", sanitize(str(e)), fp=fingerprint(cid))
    if r.status_code == 200:
        return Check("NAVER_CLIENT_ID", "네이버 검색(뉴스)", "ok", "뉴스 검색 응답 정상", fp=fingerprint(cid))
    return Check("NAVER_CLIENT_ID", "네이버 검색(뉴스)", "error", sanitize(f"HTTP {r.status_code} {r.text[:150]}"),
                 "Client ID/Secret 과 애플리케이션의 '검색' API 사용 설정을 확인하세요. (지도용 NCP 키와는 다른 키입니다)", fingerprint(cid))


def check_anthropic(c: httpx.Client) -> list[Check]:
    key = settings.anthropic_api_key
    if not key:
        return [Check("ANTHROPIC_API_KEY", "Claude API", "optional", "뉴스 분류를 건너뜁니다.", "console.anthropic.com 에서 API 키 발급")]
    out: list[Check] = []
    models = [("ANTHROPIC_MODEL", settings.anthropic_model), ("ANTHROPIC_BULK_MODEL", settings.anthropic_bulk_model)]
    for i, (name, model) in enumerate(models):
        if i and model == models[0][1]:
            continue
        try:
            r = c.get(f"https://api.anthropic.com/v1/models/{model}", headers={"x-api-key": key, "anthropic-version": "2023-06-01"})
        except httpx.HTTPError as e:
            out.append(Check("ANTHROPIC_API_KEY", "Claude API", "error", sanitize(str(e)), fp=fingerprint(key)))
            break
        if r.status_code == 401:
            out.append(Check("ANTHROPIC_API_KEY", "Claude API", "error", "API 키 인증 실패(401)", "키를 다시 발급해 넣으세요.", fingerprint(key)))
            break
        if r.status_code == 404:
            out.append(Check(name, f"Claude 모델({name})", "error", f"'{model}' 모델을 찾을 수 없습니다.",
                             "GitHub → Settings → Variables 의 모델 이름을 확인하세요(비우면 기본값).", None))
            continue
        if r.status_code != 200:
            out.append(Check("ANTHROPIC_API_KEY", "Claude API", "error", sanitize(f"HTTP {r.status_code} {r.text[:150]}"), fp=fingerprint(key)))
            break
    if not any(x.key == "ANTHROPIC_API_KEY" for x in out):
        out.insert(0, Check("ANTHROPIC_API_KEY", "Claude API", "ok", f"키·모델 확인({settings.anthropic_model})", fp=fingerprint(key)))
    return out


def check_smtp() -> Check:
    host = settings.smtp_host
    if not host:
        return Check("SMTP_HOST", "메일(SMTP)", "optional", "알림 다이제스트 메일을 보내지 않습니다.", "SMTP_HOST/PORT/USER/PASSWORD, MAIL_FROM")
    try:
        if settings.smtp_port == 465:
            s = smtplib.SMTP_SSL(host, settings.smtp_port, timeout=10, context=ssl.create_default_context())
        else:
            s = smtplib.SMTP(host, settings.smtp_port, timeout=10)
            s.starttls(context=ssl.create_default_context())
        with s:
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password or "")
    except smtplib.SMTPAuthenticationError:
        return Check("SMTP_HOST", "메일(SMTP)", "error", "로그인 실패", "SMTP_USER/SMTP_PASSWORD 확인(Gmail 은 앱 비밀번호)")
    except Exception as e:
        return Check("SMTP_HOST", "메일(SMTP)", "error", sanitize(f"{type(e).__name__}: {e}"), "호스트·포트(587 STARTTLS / 465 SSL) 확인")
    return Check("SMTP_HOST", "메일(SMTP)", "ok", f"{host}:{settings.smtp_port} 로그인 성공", fp=fingerprint(settings.smtp_user))


def check_vapid() -> Check:
    pub, priv = settings.vapid_public_key, settings.vapid_private_key
    if not pub and not priv:
        return Check("VAPID_PRIVATE_KEY", "웹푸시(VAPID)", "optional", "푸시 없이 메일로만 알립니다.", "npx web-push generate-vapid-keys")
    if not (pub and priv):
        return Check("VAPID_PRIVATE_KEY", "웹푸시(VAPID)", "error", "공개키·비밀키 중 하나만 있습니다.",
                     "NEXT_PUBLIC_VAPID_PUBLIC_KEY 와 VAPID_PRIVATE_KEY 를 한 쌍으로 넣으세요.", fingerprint(pub))
    try:
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

        pk = ec.derive_private_key(int.from_bytes(b64urldecode(priv), "big"), ec.SECP256R1())
        derived = pk.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        if derived != b64urldecode(pub):
            return Check("VAPID_PRIVATE_KEY", "웹푸시(VAPID)", "error", "공개키와 비밀키가 한 쌍이 아닙니다.",
                         "같은 generate-vapid-keys 결과의 두 값을 함께 넣으세요.", fingerprint(pub))
    except Exception as e:
        return Check("VAPID_PRIVATE_KEY", "웹푸시(VAPID)", "error", f"키 형식 오류: {type(e).__name__}", "base64url 형식의 키인지 확인하세요.",
                     fingerprint(pub))
    return Check("VAPID_PRIVATE_KEY", "웹푸시(VAPID)", "ok", "공개키·비밀키 한 쌍 확인", fp=fingerprint(pub))


def check_app(c: httpx.Client) -> list[Check]:
    """APP_URL 로 웹 앱 상태를 보고, CRON_SECRET 이 있으면 웹과 같은 값인지 확인한다."""
    from .config import _app_url

    # https:// 가 빠진 값(myrealty.vercel.app)도 받아 준다
    app = _app_url(os.environ.get("APP_URL")) if os.environ.get("APP_URL") else ""
    cron = os.environ.get("CRON_SECRET")
    if not app or app.startswith("http://localhost"):
        return [Check("APP_URL", "웹 앱 주소", "warn" if cron else "optional", "APP_URL 이 없거나 localhost 라 웹 앱을 확인하지 않았습니다.",
                      "GitHub → Settings → Variables 에 APP_URL(배포 주소)을 넣으세요.")]
    out: list[Check] = []
    try:
        r = c.get(f"{app}/api/health")
        h = r.json()
        if h.get("ok"):
            out.append(Check("APP_URL", "웹 앱 주소", "ok", f"{app} /api/health 정상"))
        else:
            probs = [k for k in ("db", "pendingMigrations", "authSecret") if h.get(k) not in ("ok", True, [], None)]
            out.append(Check("APP_URL", "웹 앱 주소", "warn", f"{app} 응답은 있으나 점검 실패: {', '.join(probs) or r.status_code}",
                             "웹 관리 → 시스템 화면에서 원인을 확인하세요."))
    except Exception as e:
        out.append(Check("APP_URL", "웹 앱 주소", "error", sanitize(f"{app} 접속 실패: {type(e).__name__}"), "APP_URL 이 배포 주소와 같은지 확인하세요."))
        return out
    if cron:
        try:
            r = c.get(f"{app}/api/cron/reports", params={"kind": "check"}, headers={"Authorization": f"Bearer {cron}"})
            if r.status_code == 200:
                out.append(Check("CRON_SECRET", "정기 리포트 호출 인증", "ok", "웹(Vercel)의 CRON_SECRET 과 일치", fp=fingerprint(cron)))
            elif r.status_code == 401:
                out.append(Check("CRON_SECRET", "정기 리포트 호출 인증", "error", "웹이 거부(401) — Vercel 과 GitHub 의 값이 다르거나 Vercel 에 없습니다.",
                                 "두 곳에 같은 값을 넣고 Vercel 은 재배포하세요.", fingerprint(cron)))
            else:
                out.append(Check("CRON_SECRET", "정기 리포트 호출 인증", "warn", f"HTTP {r.status_code}", fp=fingerprint(cron)))
        except httpx.HTTPError as e:
            out.append(Check("CRON_SECRET", "정기 리포트 호출 인증", "error", sanitize(str(e)), fp=fingerprint(cron)))
    return out


def check_relay(c: httpx.Client) -> Check:
    """웹(서울 리전) 중계로 공공데이터포털이 되는지. GitHub 러너(해외)에서 직접 호출이 거부될 때 수집이 이 경로로 돈다."""
    if not (settings.cron_secret and os.environ.get("APP_URL")):
        return Check("CRON_SECRET", "국내 API 중계(웹 경유)", "optional",
                     "GitHub 에서 공공데이터포털·브이월드 직접 호출이 막히면 우회할 수 없습니다.",
                     "GitHub Secrets 에 CRON_SECRET(Vercel 과 같은 값), Variables 에 APP_URL 을 넣으세요.")
    today = date.today()
    ym = f"{today.year - (today.month == 1)}{(today.month - 2) % 12 + 1:02d}"
    try:
        r = c.get(f"{settings.app_url}/api/relay", params={"url": f"{rtms.BASE}/{rtms.SERVICES[0].path}", "LAWD_CD": "11110",
                                                          "DEAL_YMD": ym, "numOfRows": 1, "pageNo": 1},
                  headers={"Authorization": f"Bearer {settings.cron_secret}"}, timeout=httpx.Timeout(30.0, connect=8.0))
    except httpx.HTTPError as e:
        return Check("CRON_SECRET", "국내 API 중계(웹 경유)", "error", sanitize(str(e)), "APP_URL 이 배포 주소인지 확인하세요.")
    if r.headers.get("x-relay") != "1":
        return Check("CRON_SECRET", "국내 API 중계(웹 경유)", "error", f"HTTP {r.status_code} — 웹이 중계를 받지 않았습니다",
                     "웹을 최신 버전으로 배포하고, Vercel 과 GitHub 의 CRON_SECRET 이 같은지 확인하세요." if r.status_code == 401 else "")
    try:
        rtms.parse_xml(r.text)
    except Exception as e:
        return Check("CRON_SECRET", "국내 API 중계(웹 경유)", "error", sanitize(f"웹의 DATA_GO_KR_KEY 로도 실패: {e}"),
                     "Vercel 의 DATA_GO_KR_KEY 와 활용신청(실거래가 11종·건축물대장)을 확인하세요.")
    return Check("CRON_SECRET", "국내 API 중계(웹 경유)", "ok", "웹(서울)을 거쳐 실거래가 응답 정상 — 직접 호출이 막혀도 수집됩니다")


def check_database() -> tuple[Check, object | None]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return Check("DATABASE_URL", "데이터베이스", "missing", "DB 없이 수집할 수 없습니다.",
                     "GitHub Secrets 에 웹(Vercel)과 같은 DATABASE_URL 을 넣으세요(Supabase 는 IPv4 풀러 주소)."), None
    try:
        from .db import connect
        from .migrate import MIGRATIONS_DIR

        conn = connect()
        done = {r["name"] for r in conn.execute("select name from schema_migrations")} if conn.execute(
            "select to_regclass('schema_migrations') as t").fetchone()["t"] else set()
        pending = [p.name for p in sorted(MIGRATIONS_DIR.glob("*.sql")) if p.name not in done]
    except Exception as e:
        return Check("DATABASE_URL", "데이터베이스", "error", sanitize(f"{type(e).__name__}: {e}"),
                     "주소·비밀번호 확인. Supabase 는 Session/Transaction pooler(IPv4) 주소를 쓰세요.", db_fingerprint(url)), None
    if pending:
        return Check("DATABASE_URL", "데이터베이스", "warn", f"미적용 마이그레이션: {', '.join(pending)}", "uv run myrealty migrate",
                     db_fingerprint(url)), conn
    return Check("DATABASE_URL", "데이터베이스", "ok", "연결·스키마 정상", fp=db_fingerprint(url)), conn


def run_checks() -> tuple[list[Check], object | None]:
    db, conn = check_database()
    checks = [db]
    with _client() as c:
        steps: list[Callable[[], Check | list[Check]]] = [
            lambda: check_data_go_kr(c), lambda: check_vworld(c), lambda: check_ncp(c), lambda: check_naver_search(c),
            lambda: check_ecos(c), lambda: check_kosis(c), lambda: check_reb(c), lambda: check_anthropic(c),
            check_smtp, check_vapid, lambda: check_app(c), lambda: check_relay(c),
        ]
        for step in steps:
            try:
                r = step()
            except Exception as e:  # 점검 자체의 버그가 다른 점검을 막지 않도록
                r = Check(getattr(step, "__name__", "check"), "점검", "error", sanitize(f"{type(e).__name__}: {e}"))
            checks.extend(r if isinstance(r, list) else [r])
    return checks, conn


ICON = {"ok": "✅", "missing": "❌", "error": "❌", "warn": "⚠️", "optional": "➖"}
LABEL = {"ok": "정상", "missing": "미설정(필수)", "error": "오류", "warn": "확인 필요", "optional": "미설정(선택)"}


def to_markdown(checks: list[Check]) -> str:
    lines = ["## MyRealty 키 점검 (GitHub Actions / ETL)", "",
             "| 상태 | 항목 | 환경 변수 | 결과 | 조치 | 지문 |", "|---|---|---|---|---|---|"]
    for ck in checks:
        cell = lambda s: (s or "").replace("|", "\\|").replace("\n", " ")  # noqa: E731
        lines.append(f"| {ICON[ck.status]} {LABEL[ck.status]} | {cell(ck.label)} | `{ck.key}` | {cell(ck.detail)} | {cell(ck.fix)} | "
                     f"{('`' + ck.fp + '`') if ck.fp else ''} |")
    lines += ["", "지문은 값의 SHA-256 앞 8자리입니다. 웹 관리 → 시스템 → 키 점검의 지문과 같으면 같은 키입니다(값은 출력하지 않음)."]
    return "\n".join(lines)


def doctor(strict: bool = False) -> dict:
    checks, conn = run_checks()
    bad = [c for c in checks if c.status in ("error", "missing")]
    md = to_markdown(checks)
    print(md)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(md + "\n")
    detail = {"checks": [asdict(c) for c in checks], "source": "github" if os.environ.get("GITHUB_ACTIONS") else "local",
              "run_url": (f"{os.environ.get('GITHUB_SERVER_URL')}/{os.environ.get('GITHUB_REPOSITORY')}/actions/runs/{os.environ.get('GITHUB_RUN_ID')}"
                          if os.environ.get("GITHUB_RUN_ID") else None)}
    if conn is not None:
        from .db import jsonb

        try:
            conn.execute("insert into job_runs (job, finished_at, status, detail) values ('doctor', now(), %s, %s)",
                         ("error" if bad else "ok", jsonb(detail)))
            conn.commit()
        finally:
            conn.close()
    if strict and bad:
        raise SystemExit(f"키 점검 실패: {', '.join(sorted({c.key for c in bad}))}")
    return {"ok": not bad, "problems": [c.key for c in bad]}
