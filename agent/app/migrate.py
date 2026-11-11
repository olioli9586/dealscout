"""Plain-SQL migrations, the same scheme as EvalBoard's lib/migrate.mts.

Every migrations/NNN_name.sql file runs once, in name order, inside its own
transaction, and is recorded in schema_migrations with a checksum. Then the
LangGraph checkpointer creates or upgrades its own tables.

Run with `python -m app.migrate`. The Vercel build runs it on every deploy
(pyproject.toml, [tool.vercel.scripts]), so no database credentials are
needed on a laptop.
"""

import asyncio
import hashlib
import sys
from pathlib import Path

import psycopg
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row

from app.db import migration_url

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

# Arbitrary constant: two deploys migrating at once take turns on this lock
# instead of both applying the same file. (EvalBoard uses 4_812_031 on its
# own database.)
LOCK_KEY = 5_190_427


def checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode()).hexdigest()


async def migrate(url: str, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """Applies pending migrations; returns the names of the files it ran."""
    files = sorted(migrations_dir.glob("*.sql"))
    async with await psycopg.AsyncConnection.connect(url, autocommit=True, row_factory=dict_row) as conn:
        await conn.execute("select pg_advisory_lock(%s)", (LOCK_KEY,))
        await conn.execute(
            """create table if not exists schema_migrations (
                 name text primary key,
                 checksum text not null,
                 applied_at timestamptz not null default now()
               )"""
        )
        rows = await (await conn.execute("select name, checksum from schema_migrations")).fetchall()
        applied = {r["name"]: r["checksum"] for r in rows}

        ran = []
        for path in files:
            sql = path.read_text()
            previous = applied.get(path.name)
            if previous is not None:
                # Editing an applied migration would leave databases that ran
                # the old version silently different from new ones.
                if previous != checksum(sql):
                    raise RuntimeError(
                        f"Migration {path.name} changed after it was applied; add a new migration instead."
                    )
                continue
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "insert into schema_migrations (name, checksum) values (%s, %s)",
                    (path.name, checksum(sql)),
                )
            ran.append(path.name)

        # Still under the lock: setup() isn't safe to run twice at once.
        await AsyncPostgresSaver(conn).setup()
        await conn.execute("select pg_advisory_unlock(%s)", (LOCK_KEY,))
        return ran


def main() -> int:
    url = migration_url()
    if not url:
        # A deploy without a database (e.g. an environment it isn't connected
        # to yet) still builds; GET /health reports the missing database.
        print("migrate: DATABASE_URL is not set, skipping")
        return 0
    ran = asyncio.run(migrate(url))
    print(f"migrate: applied {', '.join(ran)}" if ran else "migrate: up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
