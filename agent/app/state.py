"""The graph's state: what every checkpoint stores for a run."""

import operator
from typing import Annotated, Literal, NotRequired, TypedDict

Branch = Literal["business", "funding", "leadership", "news"]
BRANCHES: tuple[Branch, ...] = ("business", "funding", "leadership", "news")

# A branch whose share of supported claims is below this goes back for one
# more pass, at most MAX_ATTEMPTS passes per branch in all.
SUPPORT_BAR = 0.8
MAX_ATTEMPTS = 2


class BranchPlan(TypedDict):
    branch: Branch
    hints: list[str]


class Claim(TypedDict):
    field: str
    value: str
    source_url: str
    quote: str


class ResearchTask(TypedDict):
    """What one researcher gets (sent to it with Send, not read from the state)."""

    company: str
    branch: Branch
    hints: list[str]
    attempt: int
    # On a retry: the claims the verifier couldn't support last time.
    retry_claims: list[Claim]


class Finding(TypedDict):
    branch: Branch
    attempt: int
    claims: list[Claim]


class Verdict(TypedDict):
    branch: Branch
    attempt: int
    supported: list[Claim]
    unsupported: list[Claim]


class Decision(TypedDict):
    action: Literal["approve", "edit", "reject"]
    # Only for "edit": the profile to save instead of the draft.
    profile: NotRequired[dict]


class RunState(TypedDict):
    company: str
    company_key: str
    # The latest saved profile for this company, if any (long-term memory).
    previous: NotRequired[dict | None]
    plan: NotRequired[list[BranchPlan]]
    # Parallel researchers each add one finding; the reducer appends instead
    # of letting the last branch to finish overwrite the others.
    findings: Annotated[list[Finding], operator.add]
    verdicts: Annotated[list[Verdict], operator.add]
    draft: NotRequired[dict]
    decision: NotRequired[Decision]
    # The saved version number, once the save node has run.
    saved_version: NotRequired[int]


def latest_per_branch[T: (Finding, Verdict)](items: list[T]) -> dict[Branch, T]:
    """The highest-attempt entry for each branch."""
    latest: dict[Branch, T] = {}
    for item in items:
        if item["branch"] not in latest or item["attempt"] > latest[item["branch"]]["attempt"]:
            latest[item["branch"]] = item
    return latest
