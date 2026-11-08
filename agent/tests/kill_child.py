"""Starts a run whose leadership researcher hangs, so test_kill.py can
SIGKILL this process mid-graph. Usage: python -m tests.kill_child URL RUN_ID LOG"""

import asyncio
import sys
from pathlib import Path

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.db import make_pool
from app.fakes import FakeModels
from app.graph import build_graph
from app.profiles import ProfileStore
from app.runs import Runs


async def main(url: str, run_id: str, log: str) -> None:
    pool = make_pool(url)
    await pool.open()
    # News finishes a little after business and funding, so a test that cuts
    # the run too early sees news run twice.
    models = FakeModels(research_seconds={"leadership": 60, "news": 0.3}, log_path=Path(log))
    runs = Runs(pool, build_graph(models, ProfileStore(pool), AsyncPostgresSaver(pool)), lease_seconds=1)
    await runs.start("Killed Co", run_id=run_id)


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:4]))
