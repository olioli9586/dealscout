import json

import pytest

from app.fakes import WEAK_URL, FakeModels, fake_usage
from app.profile_schema import SavedProfile, unknown_profile
from app.runs import SpendCapReached, summarize
from tests.conftest import research_calls


async def saved_profiles(pool) -> list[dict]:
    async with pool.connection() as conn:
        rows = await (
            await conn.execute("select company_key, version, profile from profiles order by id")
        ).fetchall()
    return [dict(r) for r in rows]


async def test_a_run_pauses_for_approval_with_a_draft(make_runs):
    runs, models = make_runs()
    run = await runs.start("Acme Corp")

    assert run["status"] == "awaiting_approval"
    assert run["next"] == ["approve"]
    assert run["resumable"] is False
    assert run["plan"] == ["business", "funding", "leadership", "news"]
    assert sorted((f["branch"], f["attempt"]) for f in run["findings"]) == [
        ("business", 1),
        ("funding", 1),
        ("leadership", 1),
        ("news", 1),
    ]
    assert all(v["unsupported"] == 0 for v in run["verdicts"])
    assert run["draft"]["company_name"] == "Acme Corp"
    assert run["draft"]["leadership"] == ["Acme Corp leadership"]
    assert run["draft"]["sources"]["website"] == ["https://example.com/business"]
    # Every draft is a whole, valid profile.
    SavedProfile.model_validate(run["draft"])
    assert run["previous_version"] is None
    assert research_calls(models) == {"business": [1], "funding": [1], "leadership": [1], "news": [1]}


async def test_approving_saves_version_1_and_the_next_run_remembers_it(make_runs, pool):
    runs, _ = make_runs()
    first = await runs.start("Acme Corp")
    approved = await runs.decide(first["id"], {"action": "approve"})

    assert approved["status"] == "saved"
    assert approved["saved_version"] == 1
    assert await saved_profiles(pool) == [
        {"company_key": "acme corp", "version": 1, "profile": first["draft"]}
    ]

    # Same company, different spacing and case: found through company_key.
    second = await runs.start("  ACME   corp ")
    assert second["previous_version"] == 1
    assert (await runs.decide(second["id"], {"action": "approve"}))["saved_version"] == 2


async def test_an_edit_saves_the_edited_profile(make_runs, pool):
    runs, _ = make_runs()
    run = await runs.start("Acme Corp")
    edited = unknown_profile("Acme Corporation").model_dump() | {"leadership": ["Jane Doe, CEO"]}
    await runs.decide(run["id"], {"action": "edit", "profile": edited})

    assert [p["profile"] for p in await saved_profiles(pool)] == [edited]


async def test_rejecting_saves_nothing(make_runs, pool):
    runs, _ = make_runs()
    run = await runs.start("Acme Corp")
    rejected = await runs.decide(run["id"], {"action": "reject"})

    assert rejected["status"] == "rejected"
    assert rejected["next"] == []
    assert await saved_profiles(pool) == []


async def test_a_decision_is_refused_unless_the_run_is_waiting_for_one(make_runs):
    runs, _ = make_runs()
    run = await runs.start("Acme Corp")
    await runs.decide(run["id"], {"action": "approve"})

    assert await runs.decide(run["id"], {"action": "approve"}) is None


async def test_a_weak_branch_gets_one_more_pass_with_its_unsupported_claims(make_runs):
    runs, models = make_runs(FakeModels(weak_passes={"funding": 1}))
    run = await runs.start("Acme Corp")

    assert research_calls(models) == {"business": [1], "funding": [1, 2], "leadership": [1], "news": [1]}
    retry = [t for t in models.tasks if t["attempt"] == 2]
    assert [t["branch"] for t in retry] == ["funding"]
    assert {c["field"] for c in retry[0]["retry_claims"]} == {"funding_status", "deal_signals"}
    assert all(c["source_url"] == WEAK_URL for c in retry[0]["retry_claims"])
    # The second pass is supported, so its claims reach the draft.
    assert run["status"] == "awaiting_approval"
    assert run["draft"]["funding_status"] == "Acme Corp funding_status"


async def test_retries_stop_after_the_cap_and_unsupported_claims_stay_out(make_runs):
    runs, models = make_runs(FakeModels(weak_passes={"news": 99}))
    run = await runs.start("Acme Corp")

    assert research_calls(models)["news"] == [1, 2]
    assert run["status"] == "awaiting_approval"
    assert run["draft"]["recent_news"] == []
    assert "recent_news" not in run["draft"]["sources"]


async def test_the_draft_is_stored_as_json(make_runs, pool):
    runs, _ = make_runs()
    run = await runs.start('Quote "Co"')
    await runs.decide(run["id"], {"action": "approve"})

    async with pool.connection() as conn:
        row = await (await conn.execute("select profile::text as raw from profiles")).fetchone()
    assert json.loads(row["raw"])["company_name"] == 'Quote "Co"'


async def test_every_node_reports_its_usage_and_the_run_totals_it(make_runs, pool):
    runs, _ = make_runs(FakeModels(costs={"plan": 0.01, "research": 0.1, "write": 0.05}))
    run = await runs.start("Acme Corp")

    usage = run["usage"]
    assert sorted(c["node"] for c in usage["calls"]) == ["planner"] + ["researcher"] * 4 + ["writer"]
    assert usage["cost_usd"] == pytest.approx(0.01 + 4 * 0.1 + 0.05)
    assert run["budget_usd"] == 1.5
    async with pool.connection() as conn:
        row = await (await conn.execute("select cost_usd from runs where id = %s", (run["id"],))).fetchone()
    assert row["cost_usd"] == pytest.approx(usage["cost_usd"])


def test_the_summary_prices_an_entry_from_before_caching_the_same_uncached():
    before = fake_usage("researcher", 0.2, "news", 1)
    del before["uncached_cost_usd"]
    cached = fake_usage("writer", 0.1) | {"uncached_cost_usd": 0.3}

    summary = summarize([before, cached])
    assert summary["cost_usd"] == pytest.approx(0.3)
    assert summary["uncached_cost_usd"] == pytest.approx(0.5)


async def test_a_retry_runs_only_if_the_budget_left_pays_for_another_pass(make_runs):
    # Four first passes at $0.30 leave $0.30 of a $1.50 budget: enough for
    # one more pass, so only one of the two weak branches is retried.
    models = FakeModels(weak_passes={"funding": 1, "news": 1}, costs={"research": 0.3})
    runs, _ = make_runs(models, run_budget_usd=1.5)
    run = await runs.start("Acme Corp")

    calls = research_calls(models)
    assert sorted([calls["funding"], calls["news"]]) == [[1], [1, 2]]
    assert calls["business"] == calls["leadership"] == [1]
    assert run["status"] == "awaiting_approval"
    assert run["usage"]["cost_usd"] == pytest.approx(1.5)


async def test_a_spent_budget_skips_retries_but_still_writes_a_draft(make_runs):
    models = FakeModels(weak_passes={"news": 1}, costs={"research": 0.5})
    runs, _ = make_runs(models, run_budget_usd=1.0)
    run = await runs.start("Acme Corp")

    assert research_calls(models)["news"] == [1]
    assert run["status"] == "awaiting_approval"
    assert run["draft"]["recent_news"] == []


async def test_a_budget_spent_by_the_planner_skips_research(make_runs):
    models = FakeModels(costs={"plan": 2.0})
    runs, _ = make_runs(models, run_budget_usd=1.0)
    run = await runs.start("Acme Corp")

    assert research_calls(models) == {}
    assert run["draft"]["website"] == "unknown"


async def test_the_daily_cap_refuses_new_runs_once_spent(make_runs):
    runs, _ = make_runs(FakeModels(costs={"research": 0.3}), daily_usd=1.0)
    await runs.start("Acme Corp")  # $1.20: the cap is checked before a run, not during it

    with pytest.raises(SpendCapReached):
        await runs.start("Beta Inc")
    assert await runs.spent_today() == pytest.approx(1.2)
