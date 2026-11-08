from uuid import uuid4

import httpx
import pytest

from app.fakes import FakeModels
from app.main import app, lifespan, runs_from_env
from app.profile_schema import unknown_profile


@pytest.fixture
async def client(make_runs):
    runs, _ = make_runs()
    app.state.runs = runs
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent") as c:
        yield c
    app.state.runs = None


async def test_health_lists_the_applied_migrations(client):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True, "migrations": ["001_init.sql", "002_cost.sql"]}


async def test_start_approve_and_read_a_run(client):
    started = await client.post("/runs", json={"company": "  Acme Corp "})
    assert started.status_code == 201
    run = started.json()
    assert run["company"] == "Acme Corp"
    assert run["status"] == "awaiting_approval"

    approved = await client.post(f"/runs/{run['id']}/decision", json={"action": "approve"})
    assert approved.status_code == 200
    assert approved.json()["saved_version"] == 1

    read = await client.get(f"/runs/{run['id']}")
    assert read.status_code == 200
    assert read.json()["status"] == "saved"


@pytest.mark.parametrize("body", [{}, {"company": "   "}, {"company": "x" * 201}, {"company": 7}])
async def test_a_run_needs_a_company_name(client, body):
    assert (await client.post("/runs", json=body)).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"action": "edit"},
        {"action": "approve", "profile": {"name": "x"}},
        {"action": "ship it"},
        {"action": "edit", "profile": "not an object"},
        # An edited profile must be whole and valid.
        {"action": "edit", "profile": {"company_name": "Acme"}},
        {"action": "edit", "profile": unknown_profile("Acme").model_dump() | {"confidence": "sure"}},
        {"action": "edit", "profile": unknown_profile("Acme").model_dump() | {"ceo": "Jane Doe"}},
    ],
)
async def test_a_decision_must_be_well_formed(client, body):
    run = (await client.post("/runs", json={"company": "Acme"})).json()
    assert (await client.post(f"/runs/{run['id']}/decision", json=body)).status_code == 422


async def test_unknown_and_malformed_run_ids(client):
    unknown = uuid4()
    assert (await client.get(f"/runs/{unknown}")).status_code == 404
    assert (await client.post(f"/runs/{unknown}/resume")).status_code == 404
    assert (await client.post(f"/runs/{unknown}/decision", json={"action": "approve"})).status_code == 404
    assert (await client.get("/runs/not-a-uuid")).status_code == 422


async def test_conflicts_when_the_run_is_in_the_wrong_state(client):
    run = (await client.post("/runs", json={"company": "Acme"})).json()
    assert (await client.post(f"/runs/{run['id']}/resume")).status_code == 409
    await client.post(f"/runs/{run['id']}/decision", json={"action": "reject"})
    assert (await client.post(f"/runs/{run['id']}/decision", json={"action": "approve"})).status_code == 409


async def test_no_database_means_503():
    app.state.runs = None
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent") as c:
        assert (await c.get("/health")).status_code == 503
        assert (await c.post("/runs", json={"company": "Acme"})).status_code == 503


async def test_the_api_docs_are_not_served(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert (await client.get(path)).status_code == 404


async def test_lifespan_wires_the_graph_to_the_database(db_url, monkeypatch, pool):
    monkeypatch.setenv("DATABASE_URL", db_url)
    async with lifespan(app):
        run = await app.state.runs.start("Acme Corp")
        assert run["status"] == "awaiting_approval"
    app.state.runs = None


async def test_lifespan_rejects_an_unknown_model_setting(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("AGENT_MODELS", "gpt")
    with pytest.raises(RuntimeError, match="AGENT_MODELS='gpt'"):
        async with lifespan(app):
            pass


async def test_an_edited_profile_is_saved_as_sent(client):
    run = (await client.post("/runs", json={"company": "Acme"})).json()
    edited = unknown_profile("Acme Corporation").model_dump() | {"website": "acme.example"}
    res = await client.post(f"/runs/{run['id']}/decision", json={"action": "edit", "profile": edited})
    assert res.status_code == 200
    assert res.json()["saved_version"] == 1


async def test_the_daily_cap_answers_429(make_runs):
    runs, _ = make_runs(FakeModels(costs={"research": 0.3}), daily_usd=1.0)
    app.state.runs = runs
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent") as c:
        first = await c.post("/runs", json={"company": "Acme"})
        assert first.status_code == 201
        second = await c.post("/runs", json={"company": "Beta"})
        assert second.status_code == 429
        assert "daily spend cap" in second.json()["detail"]
        assert (await c.post(f"/runs/{first.json()['id']}/resume")).status_code == 429
    app.state.runs = None


@pytest.mark.parametrize("value", ["nan", "inf", "-1", "ten"])
def test_a_spend_limit_that_would_switch_itself_off_is_refused(monkeypatch, value):
    monkeypatch.setenv("AGENT_DAILY_USD", value)
    with pytest.raises((RuntimeError, ValueError)):
        runs_from_env(None, None)


def test_real_models_get_a_daily_cap_even_when_none_is_set(monkeypatch):
    monkeypatch.setenv("AGENT_MODELS", "anthropic")
    monkeypatch.delenv("AGENT_DAILY_USD", raising=False)
    monkeypatch.setenv("AGENT_RUN_BUDGET_USD", "0.75")
    runs = runs_from_env(None, None)
    assert (runs.daily_usd, runs.run_budget_usd) == (5.0, 0.75)
