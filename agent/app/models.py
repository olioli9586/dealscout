"""The parts of the graph that call a model, behind one interface.

Day 2 has only the fakes (app/fakes.py); the Anthropic implementation
replaces them node by node later. The graph itself never imports either.
"""

from typing import Protocol

from app.state import BranchPlan, Finding, ResearchTask, Verdict


class Models(Protocol):
    async def plan(self, company: str, previous: dict | None) -> list[BranchPlan]: ...

    async def research(self, task: ResearchTask) -> Finding: ...

    async def verify(self, finding: Finding) -> Verdict: ...

    async def write(self, company: str, verdicts: list[Verdict], previous: dict | None) -> dict: ...
