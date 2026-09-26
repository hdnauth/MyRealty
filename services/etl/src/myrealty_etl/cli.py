"""myrealty CLI — ETL 잡 엔트리포인트.

예) uv run myrealty migrate
    uv run myrealty daily          # 매일 아침 전체 파이프라인
    uv run myrealty rtms --months 3
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Callable

from .db import connect, job_run

COMMANDS: dict[str, tuple[str, Callable[[argparse.Namespace], dict | list | None], Callable[[argparse.ArgumentParser], None] | None]] = {}


def command(name: str, help: str, args: Callable[[argparse.ArgumentParser], None] | None = None):
    def deco(fn):
        COMMANDS[name] = (help, fn, args)
        return fn
    return deco


def _with_job(name: str, fn: Callable) -> dict:
    with connect() as conn, job_run(conn, name) as detail:
        detail.update(fn(conn) or {})
        return detail


@command("migrate", "DB 마이그레이션 적용")
def _migrate(ns):
    from .migrate import migrate
    return {"applied": migrate()}


@command("rtms", "실거래 최근 N개월 재수집", lambda p: p.add_argument("--months", type=int, default=3))
def _rtms(ns):
    from .jobs.rtms_job import collect_recent
    return _with_job("rtms", lambda c: collect_recent(c, ns.months))


@command("backfill", "실거래 과거 백필", lambda p: p.add_argument("--max-months", type=int, default=6))
def _backfill(ns):
    from .jobs.rtms_job import backfill
    return _with_job("backfill", lambda c: backfill(c, ns.max_months))


@command("geocode", "좌표 없는 단지/읍면동 지오코딩")
def _geocode(ns):
    from .transforms.geocode import geocode_pending
    return _with_job("geocode", geocode_pending)


def _demo_args(p):
    p.add_argument("--email", help="데모 물건을 등록할 사용자 이메일(허용 목록에도 추가)")
    p.add_argument("--reset", action="store_true", help="데모 데이터만 삭제")


@command("link", "관심 물건 ↔ 단지 연결")
def _link(ns):
    from .transforms.complexes import link_watch_items
    return _with_job("link", link_watch_items)


# 매일 파이프라인: 각 단계는 키가 없으면 건너뛰고, 실패해도 다음 단계를 계속한다.
DAILY_STEPS: list[tuple[str, str]] = [
    ("rtms", "myrealty_etl.jobs.rtms_job:collect_recent"),
    ("backfill", "myrealty_etl.jobs.rtms_job:backfill"),
    ("geocode", "myrealty_etl.transforms.geocode:geocode_pending"),
    ("link", "myrealty_etl.transforms.complexes:link_watch_items"),
]


@command("daily", "매일 파이프라인 전체 실행", lambda p: p.add_argument("--only", nargs="*", help="실행할 단계만"))
def _daily(ns):
    import importlib

    results = {}
    for name, target in DAILY_STEPS:
        if ns.only and name not in ns.only:
            continue
        mod, fn = target.split(":")
        func = getattr(importlib.import_module(mod), fn)
        try:
            results[name] = _with_job(name, func)
        except Exception as e:  # 한 단계 실패가 전체를 막지 않도록
            logging.getLogger("daily").exception("%s 실패", name)
            results[name] = {"error": repr(e)}
    return results


@command("seed-demo", "데모 데이터 생성(키 없이 화면 확인용)", _demo_args)
def _seed_demo(ns):
    from .demo import reset, seed_demo
    with connect() as conn:
        if ns.reset:
            reset(conn)
            return {"reset": True}
        if not ns.email:
            raise SystemExit("--email 이 필요합니다")
        return seed_demo(conn, ns.email)


@command("allow-email", "로그인 허용 이메일 추가", lambda p: p.add_argument("email"))
def _allow(ns):
    with connect() as conn:
        conn.execute("insert into allowed_emails (email) values (lower(%s)) on conflict do nothing", (ns.email,))
        conn.commit()
    return {"allowed": ns.email.lower()}


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(prog="myrealty")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name, (help_, _, add_args) in COMMANDS.items():
        p = sub.add_parser(name, help=help_)
        if add_args:
            add_args(p)
    ns = parser.parse_args(argv)
    result = COMMANDS[ns.cmd][1](ns)
    print(json.dumps(result, ensure_ascii=False, default=str, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
