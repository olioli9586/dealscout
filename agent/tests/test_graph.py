import json

from app.fakes import WEAK_URL, FakeModels
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
    assert run["draft"]["name"] == "Acme Corp"
    assert run["draft"]["ceo"] == "Acme Corp ceo"
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
    edited = {"name": "Acme Corporation", "ceo": "Jane Doe"}
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
    assert {c["field"] for c in retry[0]["retry_claims"]} == {"total_funding", "last_round"}
    assert all(c["source_url"] == WEAK_URL for c in retry[0]["retry_claims"])
    # The second pass is supported, so its claims reach the draft.
    assert run["status"] == "awaiting_approval"
    assert run["draft"]["total_funding"] == "Acme Corp total_funding"


async def test_retries_stop_after_the_cap_and_unsupported_claims_stay_out(make_runs):
    runs, models = make_runs(FakeModels(weak_passes={"news": 99}))
    run = await runs.start("Acme Corp")

    assert research_calls(models)["news"] == [1, 2]
    assert run["status"] == "awaiting_approval"
    assert "recent_news" not in run["draft"]


async def test_the_draft_is_stored_as_json(make_runs, pool):
    runs, _ = make_runs()
    run = await runs.start('Quote "Co"')
    await runs.decide(run["id"], {"action": "approve"})

    async with pool.connection() as conn:
        row = await (await conn.execute("select profile::text as raw from profiles")).fetchone()
    assert json.loads(row["raw"])["name"] == 'Quote "Co"'
