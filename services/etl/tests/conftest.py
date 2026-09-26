import os
from pathlib import Path

import psycopg
import pytest

FIXTURES = Path(__file__).parent / "fixtures"
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql://myrealty:myrealty@localhost:5432/myrealty_test")


@pytest.fixture
def fixture_text():
    return lambda name: (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def db_url():
    """테스트용 DB를 새로 만들고 마이그레이션을 적용한다. Postgres 가 없으면 DB 테스트는 skip."""
    base, _, name = TEST_DB.rpartition("/")
    try:
        with psycopg.connect(f"{base}/postgres", autocommit=True) as c:
            c.execute(f'drop database if exists "{name}" with (force)')
            c.execute(f'create database "{name}"')
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres 사용 불가: {e}")
    from myrealty_etl.migrate import migrate
    migrate(TEST_DB)
    return TEST_DB


@pytest.fixture
def conn(db_url):
    from myrealty_etl.db import connect
    c = connect(db_url)
    # 테스트 간 격리: 사용자 테이블 전부 비우기 (코드가 중간 commit 을 하므로 rollback 만으로는 부족)
    tables = [r["tablename"] for r in c.execute(
        "select tablename from pg_tables where schemaname = 'public' and tablename not in ('schema_migrations', 'spatial_ref_sys')"
    )]
    c.execute("truncate " + ", ".join(f'"{t}"' for t in tables) + " restart identity cascade")
    c.commit()
    yield c
    c.rollback()
    c.close()
