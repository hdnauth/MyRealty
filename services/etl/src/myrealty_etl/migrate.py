"""db/migrations/*.sql 을 순서대로 한 번씩 적용한다."""

from __future__ import annotations

from pathlib import Path

from .db import connect

MIGRATIONS_DIR = Path(__file__).resolve().parents[4] / "db" / "migrations"


def migrate(url: str | None = None, directory: Path = MIGRATIONS_DIR) -> list[str]:
    applied: list[str] = []
    with connect(url) as conn:
        conn.execute(
            "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
        )
        done = {r["name"] for r in conn.execute("select name from schema_migrations")}
        for path in sorted(directory.glob("*.sql")):
            if path.name in done:
                continue
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("insert into schema_migrations (name) values (%s)", (path.name,))
            conn.commit()
            applied.append(path.name)
    return applied
