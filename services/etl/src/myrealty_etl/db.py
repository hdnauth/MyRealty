"""psycopg3 연결 헬퍼."""

from __future__ import annotations

import contextlib
import json
import os
from collections.abc import Iterator
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import settings


def connect(url: str | None = None) -> psycopg.Connection:
    conn = psycopg.connect(url or settings.database_url, row_factory=dict_row, autocommit=False)
    if os.environ.get("DATABASE_PREPARE") == "false":  # 트랜잭션 풀러(pgbouncer) 호환
        conn.prepare_threshold = None
    return conn


@contextlib.contextmanager
def transaction(url: str | None = None) -> Iterator[psycopg.Connection]:
    conn = connect(url)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def jsonb(v: Any) -> Jsonb:
    return Jsonb(v, dumps=lambda o: json.dumps(o, ensure_ascii=False, default=str))


@contextlib.contextmanager
def job_run(conn: psycopg.Connection, job: str) -> Iterator[dict]:
    """job_runs 에 실행 이력을 남긴다. detail dict 에 결과를 채우면 함께 저장된다."""
    row = conn.execute("insert into job_runs (job) values (%s) returning id", (job,)).fetchone()
    conn.commit()
    detail: dict = {}
    try:
        yield detail
        conn.execute(
            "update job_runs set finished_at = now(), status = 'ok', detail = %s where id = %s",
            (jsonb(detail), row["id"]),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        detail["error"] = repr(e)
        conn.execute(
            "update job_runs set finished_at = now(), status = 'error', detail = %s where id = %s",
            (jsonb(detail), row["id"]),
        )
        conn.commit()
        raise
