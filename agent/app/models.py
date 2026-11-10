"""The parts of the graph that call a model, behind one interface.

Two implementations: the fakes (app/fakes.py; no key, no cost) and the
Anthropic one (app/anthropic_models.py). The graph itself never imports
either.

Each method returns its result together with what it used. The node stores
both in the same state update, so a node's usage is checkpointed exactly when
its result is: a node that finished is counted once, even after a resume.
"""

from typing import Protocol

from app.state import BranchPlan, Finding, ResearchTask, Usage, Verdict


class Models(Protocol):
    # previous: the company's latest saved version ({"version", "saved_at",
    # "profile", ...}, see ProfileStore.latest), if any.
    async def plan(self, company: str, previous: dict | None) -> tuple[list[BranchPlan], list[Usage]]: ...

    async def research(self, task: ResearchTask) -> tuple[Finding, list[Usage]]: ...

    async def verify(self, finding: Finding) -> tuple[Verdict, list[Usage]]: ...

    # previous: the latest saved profile itself, if any.
    async def write(
        self, company: str, verdicts: list[Verdict], previous: dict | None
    ) -> tuple[dict, list[Usage]]: ...
