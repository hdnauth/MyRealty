"""외부 API 호출 공통: 재시도, 일일 호출량 기록."""

from __future__ import annotations

import logging
import time
from datetime import date

import httpx

log = logging.getLogger(__name__)

_client: httpx.Client | None = None


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


def get(url: str, *, params: dict | None = None, headers: dict | None = None, retries: int = 3) -> httpx.Response:
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
            wait = 2 ** (attempt + 1)
            log.warning("GET %s 실패(%s), %ss 후 재시도", url, e, wait)
            time.sleep(wait)
    assert last is not None
    raise last
