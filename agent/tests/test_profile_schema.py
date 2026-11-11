"""Memory in the profile: what a re-run keeps from the saved version, and
what counts as a change."""

from app.profile_schema import diff_profiles, to_saved, unknown_profile


def profile(**fields) -> dict:
    return unknown_profile("Acme").model_dump() | fields


def verdict(*claims: tuple[str, str, str]) -> dict:
    return {
        "branch": "business",
        "attempt": 1,
        "supported": [{"field": f, "value": v, "source_url": u, "quote": v} for f, v, u in claims],
        "unsupported": [],
    }


def test_a_field_this_run_found_nothing_for_keeps_the_saved_value_and_its_sources():
    previous = profile(
        website="acme.com",
        founded_year="1999",
        leadership=["Jane Doe, CEO"],
        sources={"website": ["https://acme.com/"], "founded_year": ["https://wiki/acme"]},
    )
    written = unknown_profile("Acme").model_copy(update={"website": "acme.io", "founded_year": "2001"})

    saved = to_saved(written, [verdict(("website", "acme.io", "https://acme.io/"))], previous)

    # Verified again: the new value and source win.
    assert saved["website"] == "acme.io" and saved["sources"]["website"] == ["https://acme.io/"]
    # Not verified this run: the writer's 2001 is dropped, the saved 1999 kept.
    assert saved["founded_year"] == "1999" and saved["sources"]["founded_year"] == ["https://wiki/acme"]
    assert saved["leadership"] == ["Jane Doe, CEO"] and saved["sources"]["leadership"] == []
    assert saved["carried_over"] == ["founded_year", "leadership"]
    # Unknown before and not found now: still unknown, and not "carried".
    assert saved["industry"] == "unknown" and "industry" not in saved["carried_over"]


def test_without_a_saved_version_nothing_is_carried_over():
    saved = to_saved(unknown_profile("Acme"), [verdict(("website", "acme.com", "https://acme.com/"))])
    assert saved["carried_over"] == [] and saved["founded_year"] == "unknown"


def test_case_spacing_and_list_order_are_not_changes():
    before = profile(hq_location="Austin,  Texas", leadership=["Jane Doe, CEO", "Bo Li, CFO"])
    after = profile(hq_location="austin, texas", leadership=["Bo Li, CFO", "jane doe, CEO"])
    assert diff_profiles(before, after) == []


def test_changed_fact_fields_are_listed_and_derived_ones_are_not():
    before = profile(funding_status="Series A", recent_news=["Launched X"], summary="Old.", confidence="low")
    after = profile(funding_status="Series B", recent_news=["Launched X", "Hired a CFO"], summary="New.")
    assert diff_profiles(before, after) == [
        {"field": "funding_status", "before": "Series A", "after": "Series B"},
        {"field": "recent_news", "before": ["Launched X"], "after": ["Launched X", "Hired a CFO"]},
    ]


def test_a_profile_saved_before_leadership_existed_reads_it_as_unknown():
    day2 = profile()
    del day2["leadership"]
    assert diff_profiles(day2, profile(leadership=["Jane Doe, CEO"])) == [
        {"field": "leadership", "before": [], "after": ["Jane Doe, CEO"]}
    ]
    assert to_saved(unknown_profile("Acme"), [], day2)["leadership"] == []
