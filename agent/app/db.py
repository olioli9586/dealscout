"""Database settings and the connection pool.

Runtime queries go through Neon's pooled URL (DATABASE_URL), so server-side
prepared statements are off: a transaction-mode pooler can hand the next
statement to a different server connection. Migrations need a session of
their own (advisory lock), so they use DATABASE_URL_UNPOOLED.
"""

import os

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

CONNECTION_KWARGS = {"autocommit": True, "prepare_threshold": None, "row_factory": dict_row}


def database_url() -> str | None:
    return os.environ.get("DATABASE_URL")


def migration_url() -> str | None:
    return os.environ.get("DATABASE_URL_UNPOOLED") or database_url()


def make_pool(url: str) -> AsyncConnectionPool:
    """A small pool, opened by the caller. Serverless instances are many and
    short-lived, so each keeps few connections and drops idle ones; the check
    replaces a connection that went stale while the instance was frozen."""
    return AsyncConnectionPool(
        url,
        min_size=0,
        max_size=4,
        max_idle=60,
        kwargs=CONNECTION_KWARGS,
        check=AsyncConnectionPool.check_connection,
        open=False,
    )
