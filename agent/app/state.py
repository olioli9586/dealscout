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
    # Every URL the researcher's web tools returned (search results and
    # fetched pages), read from the API's result blocks, not from the model.
    sources: list[str]


class Verdict(TypedDict):
    branch: Branch
    attempt: int
    supported: list[Claim]
    unsupported: list[Claim]


class Usage(TypedDict):
    """What one node's model calls used. Zero requests for a node that called
    no model (the fakes, the mechanical verifier)."""

    node: str
    branch: Branch | None
    attempt: int | None
    model: str
    effort: str | None
    requests: int
    input_tokens: int
    output_tokens: int
    cache_creation_input_tokens: int
    cache_read_input_tokens: int
    web_search_requests: int
    web_fetch_requests: int
    # USD; None if a response came from a model with no known price.
    cost_usd: float | None
    seconds: float


class Decision(TypedDict):
    action: Literal["approve", "edit", "reject"]
    # Only for "edit": the profile to save instead of the draft.
    profile: NotRequired[dict]


class RunState(TypedDict):
    company: str
    company_key: str
    # The most this run may spend on model calls, in USD (see spent()).
    budget_usd: float
    # The latest saved profile for this company, if any (long-term memory).
    previous: NotRequired[dict | None]
    plan: NotRequired[list[BranchPlan]]
    # Parallel researchers each add one finding; the reducer appends instead
    # of letting the last branch to finish overwrite the others.
    findings: Annotated[list[Finding], operator.add]
    verdicts: Annotated[list[Verdict], operator.add]
    # One entry per finished node that called a model. A node that was cut
    # off mid-call reports nothing, so this is a lower bound for such runs.
    usage: Annotated[list[Usage], operator.add]
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


def spent(usage: list[Usage]) -> float:
    """USD spent so far; infinite once any cost is unknown, so a budget check
    fails closed instead of ignoring calls it can't price."""
    total = 0.0
    for u in usage:
        if u["cost_usd"] is None:
            return float("inf")
        total += u["cost_usd"]
    return total
