"""외부 API 호출 공통: 재시도, 일일 호출량 기록, 국내 API 중계.

국내 API 중계: GitHub Actions 러너는 해외(미국)에 있어 브이월드는 연결을 끊고, 공공데이터포털은 키를 거부하는 일이 있다.
직접 호출이 그렇게 실패하면 웹 앱(Vercel 서울 리전)의 /api/relay 를 거쳐 다시 부른다. 웹은 자기 환경 변수의 키를 붙여
호출하므로 GitHub Secrets 의 키가 틀려도 웹 키가 맞으면 수집된다. 인증은 CRON_SECRET(웹과 같은 값).
"""

from __future__ import annotations

import logging
import re
import time
from datetime import date
from urllib.parse import urlparse

import httpx

from .config import settings

log = logging.getLogger(__name__)

_client: httpx.Client | None = None

# 중계 대상 호스트 → 키 파라미터(웹이 자기 키로 채우므로 보내지 않는다)
RELAY_HOSTS: dict[str, tuple[str, ...]] = {
    "apis.data.go.kr": ("serviceKey",),
    "api.odcloud.kr": ("serviceKey",),
    "api.vworld.kr": ("key", "domain"),
}
# 직접 호출이 실패해 중계로 바꾼 호스트(프로세스 동안 유지)
_relayed: set[str] = set()


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True,
                               headers={"User-Agent": "MyRealty-ETL/0.1"})
    return _client


class QuotaExceeded(RuntimeError):
    pass


def count_call(conn, api: str, limit: int | None = None) -> None:
    """api_quota 에 호출 1회를 기록하고 한도 초과 시 QuotaExceeded."""
    if conn is None:
        return
    row = conn.execute(
        """insert into api_quota (api, day, calls) values (%s, %s, 1)
           on conflict (api, day) do update set calls = api_quota.calls + 1
           returning calls""",
        (api, date.today()),
    ).fetchone()
    conn.commit()
    if limit is not None and row["calls"] > limit:
        raise QuotaExceeded(f"{api} 일일 호출 한도({limit}) 초과")


def relay_available() -> bool:
    return settings.kr_relay != "off" and bool(settings.cron_secret) and not settings.app_url.startswith("http://localhost")


def relay_state() -> dict:
    """화면·요약용: 중계를 쓸 수 있는지, 이번 실행에서 어느 호스트를 중계했는지."""
    return {"available": relay_available(), "hosts": sorted(_relayed)}


def _relay_get(url: str, params: dict | None) -> httpx.Response:
    host = urlparse(url).hostname or ""
    drop = RELAY_HOSTS.get(host, ())
    q = {k: v for k, v in (params or {}).items() if k not in drop}
    r = client().get(f"{settings.app_url}/api/relay", params={"url": url, **q},
                     headers={"Authorization": f"Bearer {settings.cron_secret}"}, timeout=httpx.Timeout(45.0, connect=10.0))
    if r.status_code in (401, 404) and r.headers.get("x-relay") != "1":
        # 웹이 중계를 모르거나(배포 전) 인증 실패 — 원래 오류를 보이도록 구분해서 던진다
        raise httpx.HTTPStatusError(f"중계 사용 불가(HTTP {r.status_code}): 웹 배포·CRON_SECRET 확인", request=r.request, response=r)
    return r


def _direct(url: str, params: dict | None, headers: dict | None, retries: int) -> httpx.Response:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = client().get(url, params=params, headers=headers)
            if r.status_code >= 500 or r.status_code == 429:
                raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            return r
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            last = e
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code < 500 and e.response.status_code != 429:
                raise
            if attempt + 1 < retries:
                wait = 2 ** (attempt + 1)
                log.warning("GET %s 실패(%s), %ss 후 재시도", url.split("?")[0], redact(str(e)), wait)
                time.sleep(wait)
    assert last is not None
    raise last


def _check(r: httpx.Response) -> httpx.Response:
    if r.status_code >= 400:
        raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
    return r


def get(url: str, *, params: dict | None = None, headers: dict | None = None, retries: int = 3) -> httpx.Response:
    host = urlparse(url).hostname or ""
    relayable = host in RELAY_HOSTS and relay_available()
    if relayable and (host in _relayed or settings.kr_relay == "always"):
        return _check(_relay_get(url, params))
    try:
        return _direct(url, params, headers, 1 if relayable else retries)
    except (httpx.TransportError, httpx.HTTPStatusError) as e:
        blocked = isinstance(e, httpx.TransportError) or e.response.status_code in (401, 403) or e.response.status_code >= 500
        if not (relayable and blocked):
            raise
        log.warning("%s 직접 호출 실패(%s) → 웹(서울) 중계로 다시 시도", host, e.__class__.__name__)
        try:
            r = _relay_get(url, params)
        except httpx.HTTPError as relay_err:
            log.warning("중계 실패: %s", redact(str(relay_err)))
            raise e from relay_err
        if r.status_code >= 400:
            log.warning("중계도 실패(HTTP %s): %s", r.status_code, r.text[:200])
            raise e
        _relayed.add(host)
        return r


_SECRET_PARAM = re.compile(r"(?i)\b(serviceKey|key|apiKey|api_key|crtfc_key|confmKey)=([^&\s'\"]+)")


def _secret_values() -> list[str]:
    from urllib.parse import quote

    vals = [settings.data_go_kr_key, settings.vworld_key, settings.ecos_key, settings.kosis_key, settings.reb_key,
            settings.naver_client_secret, settings.ncp_key, settings.anthropic_api_key, settings.cron_secret]
    out: list[str] = []
    for v in vals:
        if v and len(v) >= 8:
            out += [v, quote(v, safe=""), quote(quote(v, safe=""), safe="")]
    return sorted(set(out), key=len, reverse=True)


def redact(text: str) -> str:
    """오류 기록·로그에 키가 남지 않게 가린다: URL 쿼리의 키 파라미터 + 경로에 들어가는 키(ECOS 등) 값 자체."""
    text = _SECRET_PARAM.sub(r"\1=***", text)
    for v in _secret_values():
        text = text.replace(v, "***")
    return text


# 공공데이터포털 오류 코드 → 사람이 읽을 사유
_DATA_GO_KR_CODES = {
    "20": "이 API 의 활용신청이 안 됐거나 승인 대기 중입니다(공공데이터포털 마이페이지)",
    "22": "오늘 호출 한도를 넘었습니다",
    "30": "등록되지 않은 서비스키입니다(DATA_GO_KR_KEY 를 일반 인증키 Decoding 값으로 넣었는지 확인)",
    "31": "키 사용 기간이 끝났습니다(활용신청 기간 연장)",
    "32": "등록되지 않은 IP 입니다(활용신청의 IP 제한 해제)",
}


def explain_error(e: BaseException) -> str:
    """수집 오류를 화면에 보일 한 줄로(키 값은 넣지 않는다)."""
    if isinstance(e, QuotaExceeded):
        return str(e)
    if isinstance(e, httpx.HTTPStatusError):
        url = str(e.request.url) if e.request else ""
        host = urlparse(url).hostname or ""
        text = e.response.text[:2000] if e.response is not None else ""
        status = e.response.status_code if e.response is not None else 0
        m = re.search(r"<(?:resultCode|returnReasonCode)>\s*(\d+)\s*<", text)
        code = m.group(1) if m else ("30" if "SERVICE_KEY_IS_NOT_REGISTERED" in text else None)
        if "data.go.kr" in host or "odcloud" in host:
            reason = _DATA_GO_KR_CODES.get(code or "", f"요청이 거부됐습니다(HTTP {status})")
            relay = "" if relay_available() else " · 웹 중계를 쓰려면 GitHub Secrets 에 CRON_SECRET 과 APP_URL 을 넣으세요"
            return f"공공데이터포털: {reason}{relay}"
        if "vworld" in host:
            return f"브이월드: 요청이 거부됐습니다(HTTP {status}) — 키·서비스 URL(VWORLD_DOMAIN) 확인"
        if "naver.com" in host:
            return f"네이버 API 인증 실패(HTTP {status}) — Client ID/Secret 확인"
        return f"{host or '외부 API'} HTTP {status}"
    if isinstance(e, httpx.TransportError):
        try:
            host = urlparse(str(e.request.url)).hostname or ""
        except RuntimeError:  # 요청 정보가 없는 예외
            host = ""
        return f"{host or 'API 서버'} 연결 실패({e.__class__.__name__}) — 해외(GitHub) 접속 차단일 수 있습니다"
    msg = redact(str(e))
    if "오류 30" in msg or "SERVICE_KEY_IS_NOT_REGISTERED" in msg:
        return "공공데이터포털: " + _DATA_GO_KR_CODES["30"]
    return msg[:300] or e.__class__.__name__
