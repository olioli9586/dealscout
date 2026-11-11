"""The agent's HTTP API. Private: only the Next.js app reaches it, through
the AGENT_URL binding (vercel.json), so there is no public route to guard
and no CORS. Rate limits and auth live in the Next.js routes."""

import math
import os
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID

from anthropic import AsyncAnthropic
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import errors
from pydantic import BaseModel, StringConstraints, model_validator

from app.anthropic_models import AnthropicModels, ModelConfig
from app.db import database_url, make_pool
from app.edgar import server_from_env
from app.fakes import FakeModels
from app.graph import build_graph
from app.models import Models
from app.profile_schema import SavedProfile
from app.profiles import ProfileStore
from app.runs import RUN_BUDGET_USD, Runs, SpendCapReached

# With real models and no AGENT_DAILY_USD, this is the daily cap: spend
# limits fail closed.
DEFAULT_DAILY_USD = 5.0


def models_from_env() -> Models:
    kind = os.environ.get("AGENT_MODELS", "fake")
    if kind == "fake":
        return FakeModels.from_env()
    if kind == "anthropic":
        return AnthropicModels(AsyncAnthropic(), ModelConfig.from_env(), edgar_server=server_from_env())
    raise RuntimeError(f"AGENT_MODELS={kind!r} is not supported (use 'fake' or 'anthropic')")


def usd_from_env(name: str) -> float | None:
    """A dollar limit from the environment, None if unset. "nan" or "inf"
    would make every `spent >= limit` check false and switch the limit off,
    so they're refused like any other malformed value."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    value = float(raw)
    if not math.isfinite(value) or value < 0:
        raise RuntimeError(f"{name} must be a finite, non-negative number of dollars, not {raw!r}")
    return value


def runs_from_env(pool, graph) -> Runs:
    fake = os.environ.get("AGENT_MODELS", "fake") == "fake"
    budget = usd_from_env("AGENT_RUN_BUDGET_USD")
    daily = usd_from_env("AGENT_DAILY_USD")
    return Runs(
        pool,
        graph,
        run_budget_usd=RUN_BUDGET_USD if budget is None else budget,
        daily_usd=daily if daily is not None else (None if fake else DEFAULT_DAILY_USD),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    url = database_url()
    if not url:
        app.state.runs = None
        yield
        return
    pool = make_pool(url)
    await pool.open()
    graph = build_graph(models_from_env(), ProfileStore(pool), AsyncPostgresSaver(pool))
    app.state.runs = runs_from_env(pool, graph)
    try:
        yield
    finally:
        await pool.close()


app = FastAPI(title="DealScout agent", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def get_runs(request: Request) -> Runs:
    runs = request.app.state.runs
    if runs is None:
        raise HTTPException(503, "DATABASE_URL is not set")
    return runs


RunsDep = Annotated[Runs, Depends(get_runs)]


class StartRun(BaseModel):
    company: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    # The caller may pick the run's id, so it can open the run page and
    # follow progress while this request is still running the graph.
    id: UUID | None = None


# How many runs one GET /runs?ids= may ask for.
MAX_IDS = 100


class DecisionIn(BaseModel):
    action: Literal["approve", "edit", "reject"]
    # An edited profile must still be a whole, valid profile.
    profile: SavedProfile | None = None

    @model_validator(mode="after")
    def profile_only_for_edit(self) -> "DecisionIn":
        if (self.action == "edit") != (self.profile is not None):
            raise ValueError("send a profile with action 'edit', and only then")
        return self


@app.get("/health")
async def health(request: Request) -> dict:
    runs: Runs | None = request.app.state.runs
    if runs is None:
        raise HTTPException(503, "DATABASE_URL is not set")
    async with runs.pool.connection() as conn:
        rows = await (await conn.execute("select name from schema_migrations order by name")).fetchall()
    return {"ok": True, "migrations": [r["name"] for r in rows]}


@app.post("/runs", status_code=201)
async def start_run(body: StartRun, runs: RunsDep) -> dict:
    try:
        return await runs.start(body.company, str(body.id) if body.id else None)
    except SpendCapReached as err:
        raise HTTPException(429, str(err)) from err
    except errors.UniqueViolation as err:
        raise HTTPException(409, "a run with this id already exists") from err


@app.get("/runs")
async def list_runs(runs: RunsDep, ids: Annotated[str, Query(max_length=MAX_IDS * 37)]) -> list[dict]:
    """The runs with these ids (comma-separated), newest first: the run
    history, which the browser keeps. There is no way to list every run."""
    try:
        wanted = [str(UUID(i)) for i in ids.split(",") if i.strip()]
    except ValueError as err:
        raise HTTPException(422, "ids must be comma-separated run ids") from err
    if len(wanted) > MAX_IDS:
        raise HTTPException(422, f"ask for at most {MAX_IDS} runs at once")
    return await runs.summaries(wanted)


@app.get("/runs/{run_id}")
async def get_run(run_id: UUID, runs: RunsDep) -> dict:
    run = await runs.get(str(run_id))
    if run is None:
        raise HTTPException(404, "no such run")
    return run


@app.post("/runs/{run_id}/resume")
async def resume_run(run_id: UUID, runs: RunsDep) -> dict:
    try:
        run = await runs.resume(str(run_id))
    except SpendCapReached as err:
        raise HTTPException(429, str(err)) from err
    if run is None:
        await _not_found_or_conflict(
            runs, run_id, "the run is not failed or cut off (or its lease is still running)"
        )
    return run


@app.post("/runs/{run_id}/decision")
async def decide_run(run_id: UUID, body: DecisionIn, runs: RunsDep) -> dict:
    run = await runs.decide(str(run_id), body.model_dump(exclude_none=True))
    if run is None:
        await _not_found_or_conflict(runs, run_id, "the run is not waiting for approval")
    return run


async def _not_found_or_conflict(runs: Runs, run_id: UUID, conflict: str) -> None:
    if not await runs.exists(str(run_id)):
        raise HTTPException(404, "no such run")
    raise HTTPException(409, conflict)
