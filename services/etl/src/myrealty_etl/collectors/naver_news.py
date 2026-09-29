"""네이버 검색 API(뉴스). 본문은 저장하지 않고 제목·요약·링크만 사용한다.

키 두 가지를 모두 받는다(같은 NAVER_CLIENT_ID/SECRET 변수):
- 네이버 클라우드 NAVER API HUB: naverapihub.apigw.ntruss.com/search/v1/news, X-NCP-APIGW-API-KEY-ID/-KEY 헤더
  (Client ID 10자 · Secret 40자 형식)
- 네이버 개발자센터(developers.naver.com) 검색 API: openapi.naver.com/v1/search/news.json, X-Naver-Client-Id/-Secret
  (Client ID 20자 · Secret 10자 형식)
키 형식으로 먼저 고르고, 인증 실패(401·403)면 다른 쪽으로 한 번 더 시도한다. 응답 형식은 같다.
"""

from __future__ import annotations

import html
import re
from datetime import datetime
from email.utils import parsedate_to_datetime

import httpx

from .. import http
from ..config import settings

URL = "https://openapi.naver.com/v1/search/news.json"
APIHUB_URL = "https://naverapihub.apigw.ntruss.com/search/v1/news"
# 이번 실행에서 인증에 성공한 방식(매 검색마다 실패한 쪽을 먼저 부르지 않도록)
_working: str | None = None
_TAG = re.compile(r"<[^>]+>")


def clean(s: str | None) -> str:
    return html.unescape(_TAG.sub("", s or "")).strip()


def title_norm(title: str) -> str:
    """언론사 간 중복 기사 판별용: 괄호 머리말·기호·공백 제거."""
    t = re.sub(r"^\s*[\[【(][^\]】)]{1,12}[\]】)]\s*", "", title)
    return re.sub(r"[\W_]+", "", t).lower()[:60]


def parse_item(it: dict) -> dict:
    title = clean(it.get("title"))
    pub: datetime | None
    try:
        pub = parsedate_to_datetime(it["pubDate"]) if it.get("pubDate") else None
    except (TypeError, ValueError):
        pub = None
    url = it.get("originallink") or it.get("link")
    if url and not re.match(r"^https?://", url):  # javascript: 등 링크로 쓰일 수 없는 값 차단
        url = it.get("link") if re.match(r"^https?://", it.get("link") or "") else None
    source = None
    if url:
        m = re.match(r"https?://(?:www\.)?([^/]+)", url)
        source = m.group(1) if m else None
    return {
        "url": url,
        "naver_link": it.get("link"),
        "title": title,
        "description": clean(it.get("description")),
        "published_at": pub,
        "source": source,
        "title_norm": title_norm(title),
    }


def endpoints(cid: str, secret: str) -> list[tuple[str, str, dict]]:
    """(이름, URL, 헤더) — 키 형식에 맞는 쪽을 먼저."""
    hub = ("apihub", APIHUB_URL, {"X-NCP-APIGW-API-KEY-ID": cid, "X-NCP-APIGW-API-KEY": secret})
    dev = ("developers", URL, {"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": secret})
    order = [hub, dev] if len(secret) > 20 or len(cid) < 16 else [dev, hub]
    if _working:
        order.sort(key=lambda e: e[0] != _working)
    return order


def request(query: str, display: int = 30, cid: str | None = None, secret: str | None = None, get=None) -> dict:
    """뉴스 검색 원본 JSON. 인증 실패면 다른 방식으로 한 번 더. get 은 테스트·점검용 대체 호출 함수."""
    global _working
    cid = cid or settings.naver_client_id
    secret = secret or settings.naver_client_secret
    if not (cid and secret):
        raise RuntimeError("NAVER_CLIENT_ID/SECRET 미설정")
    params = {"query": query, "display": display, "start": 1, "sort": "date"}
    last: Exception | None = None
    for name, url, headers in endpoints(cid, secret):
        try:
            r = (get or http.get)(url, params=params, headers=headers)
            if hasattr(r, "raise_for_status"):
                r.raise_for_status()
            _working = name
            return r.json()
        except httpx.HTTPStatusError as e:
            if e.response is None or e.response.status_code not in (401, 403):
                raise
            last = e
    assert last is not None
    raise last


def search(query: str, display: int = 30, conn=None) -> list[dict]:
    if not (settings.naver_client_id and settings.naver_client_secret):
        raise RuntimeError("NAVER_CLIENT_ID/SECRET 미설정")
    http.count_call(conn, "naver:news", 24000)
    data = request(query, display)
    return [p for p in (parse_item(i) for i in data.get("items", [])) if p["url"] and p["title"]]
