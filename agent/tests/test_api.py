from uuid import uuid4

import httpx
import pytest

from app.main import app, lifespan


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
    assert res.json() == {"ok": True, "migrations": ["001_init.sql"]}


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
