"""Deterministic stand-ins for the model calls: no API key, no cost.

The knobs exist for tests and for the kill test on a deployed preview:
- research_seconds: how long a branch "researches" (per branch, or "*").
- weak_passes: how many passes of a branch cite a page the researcher never
  saw (from the first), so the verifier rejects them; a large number means
  it never passes.
- fail_once: branches whose first call raises (a crashed node).
- costs: the USD each call reports, per kind ("plan", "research", "write"),
  to test the run budget without spending anything.
- log_path: append "start <branch> <attempt>" / "done ..." lines, so a test
  can count calls made in another process.
"""

import asyncio
import os
from pathlib import Path

from app.profile_schema import BRANCH_FIELDS, LIST_FIELDS, CompanyProfile, to_saved, unknown_profile
from app.state import BRANCHES, Branch, BranchPlan, Claim, Finding, ResearchTask, Usage, Verdict
from app.verify import check_sources

WEAK_URL = "https://example.com/unrelated"


def fake_usage(node: str, cost: float, branch: Branch | None = None, attempt: int | None = None) -> Usage:
    return {
        "node": node,
        "branch": branch,
        "attempt": attempt,
        "model": "fake",
        "effort": None,
        "requests": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "web_search_requests": 0,
        "web_fetch_requests": 0,
        "cost_usd": cost,
        "seconds": 0.0,
    }


class FakeModels:
    def __init__(
        self,
        *,
        research_seconds: dict[str, float] | None = None,
        weak_passes: dict[str, int] | None = None,
        fail_once: set[str] = frozenset(),
        costs: dict[str, float] | None = None,
        log_path: Path | None = None,
    ):
        self.research_seconds = research_seconds or {}
        self.weak_passes = weak_passes or {}
        self.fail_once = set(fail_once)
        self.costs = costs or {}
        self.log_path = log_path
        self.calls: list[tuple[str, str, int]] = []
        self.tasks: list[ResearchTask] = []

    @classmethod
    def from_env(cls) -> "FakeModels":
        seconds = float(os.environ.get("FAKE_RESEARCH_SECONDS", "0"))
        return cls(research_seconds={"*": seconds})

    def _log(self, line: str) -> None:
        if self.log_path:
            with self.log_path.open("a") as f:
                f.write(line + "\n")

    async def plan(self, company: str, previous: dict | None) -> tuple[list[BranchPlan], list[Usage]]:
        self.calls.append(("plan", company, 0))
        plan: list[BranchPlan] = [{"branch": b, "hints": [f"{company} {b}"]} for b in BRANCHES]
        return plan, [fake_usage("planner", self.costs.get("plan", 0.0))]

    async def research(self, task: ResearchTask) -> tuple[Finding, list[Usage]]:
        branch, attempt = task["branch"], task["attempt"]
        self.calls.append(("research", branch, attempt))
        self.tasks.append(task)
        self._log(f"start {branch} {attempt}")
        if branch in self.fail_once:
            self.fail_once.discard(branch)
            raise RuntimeError(f"fake researcher {branch} crashed")
        delay = self.research_seconds.get(branch, self.research_seconds.get("*", 0))
        if delay:
            await asyncio.sleep(delay)
        weak = attempt <= self.weak_passes.get(branch, 0)
        page = f"https://example.com/{branch}"
        claims: list[Claim] = [
            {
                "field": field,
                "value": f"{task['company']} {field}",
                "source_url": WEAK_URL if weak else page,
                "quote": f"{task['company']} {field}",
            }
            for field in BRANCH_FIELDS[branch]
        ]
        self._log(f"done {branch} {attempt}")
        finding: Finding = {"branch": branch, "attempt": attempt, "claims": claims, "sources": [page]}
        return finding, [fake_usage("researcher", self.costs.get("research", 0.0), branch, attempt)]

    async def verify(self, finding: Finding) -> tuple[Verdict, list[Usage]]:
        self.calls.append(("verify", finding["branch"], finding["attempt"]))
        return check_sources(finding), []

    async def write(
        self, company: str, verdicts: list[Verdict], previous: dict | None
    ) -> tuple[dict, list[Usage]]:
        self.calls.append(("write", company, 0))
        fields = unknown_profile(company).model_dump()
        for verdict in verdicts:
            for claim in verdict["supported"]:
                if claim["field"] in LIST_FIELDS:
                    fields[claim["field"]].append(claim["value"])
                elif fields[claim["field"]] == "unknown":
                    fields[claim["field"]] = claim["value"]
        profile = to_saved(CompanyProfile(**fields), verdicts)
        return profile, [fake_usage("writer", self.costs.get("write", 0.0))]
