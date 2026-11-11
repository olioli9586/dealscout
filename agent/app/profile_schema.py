"""The profile v2 writes: v1's CompanyProfile (lib/agent.ts) plus leadership,
and the source URLs behind each field.

One Pydantic model is the schema for three things: the writer's structured
output, the fakes, and the API's check on an edited profile.

Memory: when a company was saved before, a field this run verified nothing
for keeps the saved value (to_saved), and diff_profiles reports what
changed between the saved version and the new draft.
"""

import re
from typing import Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field

from app.state import Branch, Verdict

# The profile fields each researcher may report claims for. List fields take
# one claim per item. deal_signals is shared: funding, leadership and news
# researchers can each find one.
BRANCH_FIELDS: dict[Branch, tuple[str, ...]] = {
    "business": (
        "website",
        "industry",
        "hq_location",
        "founded_year",
        "employee_count",
        "business_model",
        "products_services",
    ),
    "funding": ("funding_status", "deal_signals"),
    "leadership": ("leadership", "deal_signals"),
    "news": ("recent_news", "deal_signals"),
}

LIST_FIELDS = frozenset({"products_services", "leadership", "recent_news", "deal_signals"})


class CompanyProfile(BaseModel):
    """What the writer returns. Fields mean the same as in v1."""

    model_config = ConfigDict(extra="forbid")

    company_name: str
    website: str
    industry: str
    hq_location: str = Field(description="City, region and country of the main office")
    founded_year: str
    employee_count: str = Field(description="Approximate range, e.g. 51-200")
    business_model: str = Field(description="How the company makes money, one sentence")
    products_services: list[str]
    funding_status: str = Field(description="e.g. bootstrapped, Series B ($40M, 2025), public (NASDAQ: XYZ)")
    leadership: list[str] = Field(description='"Name, role" for each key executive')
    recent_news: list[str] = Field(description="Notable items from the last ~12 months")
    deal_signals: list[str]
    confidence: Literal["low", "medium", "high"]
    summary: str = Field(description="2-3 sentence analyst summary")


class SavedProfile(CompanyProfile):
    """What is stored: the writer's profile plus, per field, the URLs of the
    verified claims it was built from (added by code, not by the model).
    An edited profile may leave sources out."""

    sources: dict[str, list[str]] = Field(default_factory=dict)
    # Fields copied from the previous version because this run verified
    # nothing for them (the planner skipped their area, or no claim held up).
    carried_over: list[str] = Field(default_factory=list)


def value_of(profile: dict, name: str) -> str | list[str]:
    """A field's value; unknown if the profile predates the field (Day 2's
    fakes saved a different shape, and leadership came on Day 3)."""
    return profile.get(name, [] if name in LIST_FIELDS else "unknown")


def facts(saved: dict) -> dict:
    """A saved profile without what code added: what the models are shown."""
    return {name: value_of(saved, name) for name in CompanyProfile.model_fields}


def unknown_profile(company: str) -> CompanyProfile:
    """Every field unknown: what a run with no verified claims can say."""
    return CompanyProfile(
        company_name=company,
        website="unknown",
        industry="unknown",
        hq_location="unknown",
        founded_year="unknown",
        employee_count="unknown",
        business_model="unknown",
        products_services=[],
        funding_status="unknown",
        leadership=[],
        recent_news=[],
        deal_signals=[],
        confidence="low",
        summary="unknown",
    )


# Written from the claims as a whole rather than from one claim each.
DERIVED_FIELDS = frozenset({"company_name", "confidence", "summary"})


def is_unknown(value: str | list[str]) -> bool:
    return value in ("unknown", [])


def to_saved(profile: CompanyProfile, verdicts: list[Verdict], previous: dict | None = None) -> dict:
    """The profile to store: the writer's fields, with every field that no
    supported claim backs reset to unknown (output validation: the writer
    can't add facts the researchers didn't verify), plus, per field, the URLs
    of the supported claims for it, in the order they were found.

    With a previous saved version, a field this run has no supported claim
    for keeps the previous value and sources instead of becoming unknown:
    not finding a fact again isn't evidence that it changed."""
    sources: dict[str, list[str]] = {}
    for verdict in verdicts:
        for claim in verdict["supported"]:
            urls = sources.setdefault(claim["field"], [])
            if claim["source_url"] not in urls:
                urls.append(claim["source_url"])
    fields = profile.model_dump()
    carried: list[str] = []
    for name in CompanyProfile.model_fields:
        if name in DERIVED_FIELDS or name in sources:
            continue
        if previous and not is_unknown(value_of(previous, name)):
            fields[name] = value_of(previous, name)
            sources[name] = previous.get("sources", {}).get(name, [])
            carried.append(name)
        else:
            fields[name] = [] if name in LIST_FIELDS else "unknown"
    return SavedProfile(**fields, sources=sources, carried_over=carried).model_dump()


class Change(TypedDict):
    field: str
    before: str | list[str]
    after: str | list[str]


def _same(a: str | list[str], b: str | list[str]) -> bool:
    """Equal up to case, spacing and the order of list items."""

    def norm(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip().casefold()

    if isinstance(a, list) and isinstance(b, list):
        return {norm(x) for x in a} == {norm(x) for x in b}
    return isinstance(a, str) and isinstance(b, str) and norm(a) == norm(b)


def diff_profiles(before: dict, after: dict) -> list[Change]:
    """The fact fields whose value differs between two profiles, in schema
    order. The derived fields (name, confidence, summary) are left out:
    they're rewritten every run."""
    return [
        {"field": name, "before": value_of(before, name), "after": value_of(after, name)}
        for name in CompanyProfile.model_fields
        if name not in DERIVED_FIELDS and not _same(value_of(before, name), value_of(after, name))
    ]
