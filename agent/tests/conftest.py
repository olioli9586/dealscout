"""Tests run against a real Postgres: TEST_DATABASE_URL, whose database name
must contain "test" because the session starts by dropping its schema."""

import asyncio
import os

import psycopg
import pytest
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.conninfo import conninfo_to_dict

from app.db import make_pool
from app.fakes import FakeModels
from app.graph import build_graph
from app.migrate import migrate
from app.profiles import ProfileStore
from app.runs import Runs

TABLES = "runs, profiles, checkpoints, checkpoint_blobs, checkpoint_writes"


@pytest.fixture(scope="session")
def db_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        if os.environ.get("CI"):
            pytest.fail("TEST_DATABASE_URL must be set in CI")
        pytest.skip("TEST_DATABASE_URL is not set")
    if "test" not in conninfo_to_dict(url).get("dbname", ""):
        pytest.fail("TEST_DATABASE_URL must name a database with 'test' in it")
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("drop schema public cascade")
        conn.execute("create schema public")
    asyncio.run(migrate(url))
    return url


@pytest.fixture
async def pool(db_url):
    pool = make_pool(db_url)
    await pool.open()
    async with pool.connection() as conn:
        await conn.execute(f"truncate {TABLES} cascade")
    yield pool
    await pool.close()


@pytest.fixture
def make_runs(pool):
    def make(models: FakeModels | None = None, lease_seconds: float = 330) -> tuple[Runs, FakeModels]:
        models = models or FakeModels()
        graph = build_graph(models, ProfileStore(pool), AsyncPostgresSaver(pool))
        return Runs(pool, graph, lease_seconds=lease_seconds), models

    return make


def research_calls(models: FakeModels) -> dict[str, list[int]]:
    """branch -> the attempts researched, in call order."""
    calls: dict[str, list[int]] = {}
    for kind, branch, attempt in models.calls:
        if kind == "research":
            calls.setdefault(branch, []).append(attempt)
    return calls
