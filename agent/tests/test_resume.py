"""A run that dies midway resumes from its last checkpoint, and the
researchers that had already finished are not run (or paid for) again."""

import asyncio
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

from app.fakes import FakeModels
from tests.conftest import research_calls

AGENT_DIR = Path(__file__).resolve().parent.parent


async def findings_written(pool, run_id: str) -> int:
    """Finished researchers of the step in progress (the step's pending writes)."""
    async with pool.connection() as conn:
        row = await (
            await conn.execute(
                "select count(*) as n from checkpoint_writes where thread_id = %s and channel = 'findings'",
                (run_id,),
            )
        ).fetchone()
    return row["n"]


async def wait_for_findings(pool, run_id: str, n: int, alive=lambda: True) -> None:
    deadline = time.monotonic() + 30
    while await findings_written(pool, run_id) < n:
        assert alive(), "the run stopped before it could be cut off"
        assert time.monotonic() < deadline, f"fewer than {n} researchers finished within 30 s"
        await asyncio.sleep(0.02)


async def run_status(pool, run_id: str) -> str:
    async with pool.connection() as conn:
        row = await (await conn.execute("select status from runs where id = %s", (run_id,))).fetchone()
    return row["status"]


async def test_a_crashed_branch_fails_the_run_and_resume_reruns_only_that_branch(make_runs):
    runs, models = make_runs(FakeModels(fail_once={"leadership"}))
    failed = await runs.start("Acme Corp")

    assert failed["status"] == "failed"
    assert failed["resumable"] is True
    assert "fake researcher leadership crashed" in failed["error"]

    resumed = await runs.resume(failed["id"])

    assert resumed["status"] == "awaiting_approval"
    assert resumed["error"] is None
    assert research_calls(models) == {"business": [1], "funding": [1], "leadership": [1, 1], "news": [1]}
    assert sorted(f["branch"] for f in resumed["findings"]) == ["business", "funding", "leadership", "news"]


async def test_a_run_cut_off_mid_step_waits_for_its_lease_then_resumes(make_runs, pool):
    runs, models = make_runs(FakeModels(research_seconds={"leadership": 30}), lease_seconds=1)
    run_id = str(uuid4())
    task = asyncio.create_task(runs.start("Acme Corp", run_id=run_id))
    await wait_for_findings(pool, run_id, 3, alive=lambda: not task.done())
    # Like a request cut off at the function's time limit: nothing gets to
    # mark the run as failed.
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)

    assert await run_status(pool, run_id) == "running"
    assert await runs.resume(run_id) is None  # the lease still holds it
    await asyncio.sleep(1.1)
    models.research_seconds = {}
    resumed = await runs.resume(run_id)

    assert resumed["status"] == "awaiting_approval"
    assert research_calls(models) == {"business": [1], "funding": [1], "leadership": [1, 1], "news": [1]}


async def test_resume_is_refused_while_another_request_drives_the_run(make_runs):
    runs, _ = make_runs(FakeModels(research_seconds={"*": 0.3}))
    run_id = str(uuid4())
    task = asyncio.create_task(runs.start("Acme Corp", run_id=run_id))
    await asyncio.sleep(0.1)

    assert await runs.resume(run_id) is None
    assert (await task)["status"] == "awaiting_approval"


async def test_resume_is_refused_for_a_finished_run(make_runs):
    runs, _ = make_runs()
    run = await runs.start("Acme Corp")

    assert await runs.resume(run["id"]) is None


async def test_a_killed_process_resumes_without_rerunning_finished_branches(
    make_runs, pool, db_url, tmp_path
):
    log = tmp_path / "calls.log"
    run_id = str(uuid4())
    child = subprocess.Popen(
        [sys.executable, "-m", "tests.kill_child", db_url, run_id, str(log)], cwd=AGENT_DIR
    )
    try:
        await wait_for_findings(pool, run_id, 3, alive=lambda: child.poll() is None)
        os.kill(child.pid, signal.SIGKILL)
        child.wait(timeout=10)
    finally:
        if child.poll() is None:
            child.kill()

    assert await run_status(pool, run_id) == "running"
    assert log.read_text().splitlines().count("start leadership 1") == 1
    await asyncio.sleep(1.1)  # the child's lease is 1 s

    runs, _ = make_runs(FakeModels(log_path=log))
    resumed = await runs.resume(run_id)

    assert resumed["status"] == "awaiting_approval"
    lines = log.read_text().splitlines()
    # Business, funding and news ran once, in the killed process; leadership
    # started there, died with it, and ran again in this one.
    assert sorted(line for line in lines if line.startswith("start")) == [
        "start business 1",
        "start funding 1",
        "start leadership 1",
        "start leadership 1",
        "start news 1",
    ]
    assert lines.count("done leadership 1") == 1
    assert sorted(f["branch"] for f in resumed["findings"]) == ["business", "funding", "leadership", "news"]
