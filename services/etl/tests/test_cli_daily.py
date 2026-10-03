import sys
import types
from dataclasses import replace
from types import SimpleNamespace

import pytest

from myrealty_etl import cli, config


@pytest.fixture
def steps(monkeypatch):
    """DAILY_STEPS 를 가짜 단계로 바꾸고 실행 순서·인자를 기록한다."""
    ran = []
    mod = types.ModuleType("fake_daily_steps")

    def make(name):
        def fn(conn, **kw):
            ran.append((name, sorted(kw)))
            return {"ok": True}
        return fn

    names = ["rtms", "geocode", "backfill", "alerts", "push", "digest", "cleanup"]
    for n in names:
        setattr(mod, n, make(n))
    monkeypatch.setitem(sys.modules, "fake_daily_steps", mod)
    monkeypatch.setattr(cli, "DAILY_STEPS", [(n, f"fake_daily_steps:{n}") for n in names])
    monkeypatch.setattr(cli, "_with_job", lambda name, fn: fn(None))
    return ran


def _run(monkeypatch, budget, stage="all", only=None):
    monkeypatch.setattr(config, "settings", replace(config.settings, daily_budget_min=budget))
    return cli._daily(SimpleNamespace(only=only, stage=stage))


def test_daily_stages(steps, monkeypatch):
    _run(monkeypatch, None, stage="collect")
    assert [n for n, _ in steps] == ["rtms", "geocode", "backfill"]
    steps.clear()
    _run(monkeypatch, None, stage="notify")
    assert [n for n, _ in steps] == ["alerts", "push", "digest", "cleanup"]


def test_daily_budget_passes_deadline_to_backfill(steps, monkeypatch):
    _run(monkeypatch, 30, stage="collect")
    assert ("backfill", ["deadline"]) in steps
    assert ("rtms", []) in steps


def test_daily_budget_exhausted_skips_collect_but_not_notify(steps, monkeypatch):
    res = _run(monkeypatch, 1e-9)  # 이미 마감
    assert [n for n, _ in steps] == ["alerts", "push", "digest", "cleanup"]
    assert "시간 예산" in res["rtms"]["skipped"]
