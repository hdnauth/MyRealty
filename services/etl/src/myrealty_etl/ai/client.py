"""Claude API 공통: 클라이언트, 사용량 기록, 월 예산 확인."""

from __future__ import annotations

import logging
from datetime import date

from ..config import settings

log = logging.getLogger(__name__)

# 1M 토큰당 USD (입력, 출력). 캐시 읽기는 입력의 0.1배, 쓰기는 1.25배로 추정. Batch 는 50%.
PRICES = {
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-fable-5-1": (10.0, 50.0),
}


def get_client():
    if not settings.anthropic_api_key:
        return None
    import anthropic

    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def supports_effort(model: str) -> bool:
    # Haiku 4.5 는 effort 파라미터를 지원하지 않는다
    return not model.startswith("claude-haiku-4-5")


def estimate_cost(model: str, usage, batch: bool = False) -> float:
    pin, pout = PRICES.get(model, (5.0, 25.0))
    inp = getattr(usage, "input_tokens", 0) or 0
    out = getattr(usage, "output_tokens", 0) or 0
    cr = getattr(usage, "cache_read_input_tokens", 0) or 0
    cw = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cost = (inp * pin + cr * pin * 0.1 + cw * pin * 1.25 + out * pout) / 1_000_000
    return cost * (0.5 if batch else 1.0)


def record_usage(conn, purpose: str, model: str, usage, batch: bool = False) -> None:
    conn.execute(
        """insert into ai_usage (purpose, model, input_tokens, output_tokens, cache_read, cache_write, batch, cost_usd)
           values (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (purpose, model, getattr(usage, "input_tokens", 0) or 0, getattr(usage, "output_tokens", 0) or 0,
         getattr(usage, "cache_read_input_tokens", 0) or 0, getattr(usage, "cache_creation_input_tokens", 0) or 0,
         batch, estimate_cost(model, usage, batch)),
    )


def month_spend(conn) -> float:
    start = date.today().replace(day=1)
    row = conn.execute("select coalesce(sum(cost_usd), 0)::float8 as s from ai_usage where created_at >= %s", (start,)).fetchone()
    return row["s"]


def budget_left(conn) -> float:
    return settings.ai_monthly_budget_usd - month_spend(conn)


def first_text(message) -> str:
    return next((b.text for b in message.content if getattr(b, "type", None) == "text"), "")
