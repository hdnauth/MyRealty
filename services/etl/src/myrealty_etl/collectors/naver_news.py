"""네이버 검색 API(뉴스). 본문은 저장하지 않고 제목·요약·링크만 사용한다."""

from __future__ import annotations

import html
import re
from datetime import datetime
from email.utils import parsedate_to_datetime

from .. import http
from ..config import settings

URL = "https://openapi.naver.com/v1/search/news.json"
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


def search(query: str, display: int = 30, conn=None) -> list[dict]:
    if not (settings.naver_client_id and settings.naver_client_secret):
        raise RuntimeError("NAVER_CLIENT_ID/SECRET 미설정")
    http.count_call(conn, "naver:news", 24000)
    r = http.get(
        URL,
        params={"query": query, "display": display, "start": 1, "sort": "date"},
        headers={"X-Naver-Client-Id": settings.naver_client_id, "X-Naver-Client-Secret": settings.naver_client_secret},
    )
    return [p for p in (parse_item(i) for i in r.json().get("items", [])) if p["url"] and p["title"]]
