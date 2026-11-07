"""Deterministic stand-ins for the model calls: no API key, no cost.

The knobs exist for tests and for the kill test on a deployed preview:
- research_seconds: how long a branch "researches" (per branch, or "*").
- weak_passes: how many passes of a branch the verifier rejects (from the
  first); a large number means it never passes.
- fail_once: branches whose first call raises (a crashed node).
- log_path: append "start <branch> <attempt>" / "done ..." lines, so a test
  can count calls made in another process.
"""

import asyncio
import os
from pathlib import Path

from app.state import BRANCHES, Branch, BranchPlan, Claim, Finding, ResearchTask, Verdict

FIELDS: dict[Branch, list[str]] = {
    "business": ["description", "industry", "website", "founded_year", "hq_location"],
    "funding": ["total_funding", "last_round"],
    "leadership": ["ceo"],
    "news": ["recent_news"],
}

WEAK_URL = "https://example.com/unrelated"


class FakeModels:
    def __init__(
        self,
        *,
        research_seconds: dict[str, float] | None = None,
        weak_passes: dict[str, int] | None = None,
        fail_once: set[str] = frozenset(),
        log_path: Path | None = None,
    ):
        self.research_seconds = research_seconds or {}
        self.weak_passes = weak_passes or {}
        self.fail_once = set(fail_once)
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

    async def plan(self, company: str, previous: dict | None) -> list[BranchPlan]:
        self.calls.append(("plan", company, 0))
        return [{"branch": b, "hints": [f"{company} {b}"]} for b in BRANCHES]

    async def research(self, task: ResearchTask) -> Finding:
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
        claims: list[Claim] = [
            {
                "field": field,
                "value": f"{task['company']} {field}",
                "source_url": WEAK_URL if weak else f"https://example.com/{branch}",
                "quote": f"{task['company']} {field}",
            }
            for field in FIELDS[branch]
        ]
        self._log(f"done {branch} {attempt}")
        return {"branch": branch, "attempt": attempt, "claims": claims}

    async def verify(self, finding: Finding) -> Verdict:
        self.calls.append(("verify", finding["branch"], finding["attempt"]))
        supported = [c for c in finding["claims"] if c["source_url"] != WEAK_URL]
        unsupported = [c for c in finding["claims"] if c["source_url"] == WEAK_URL]
        return {
            "branch": finding["branch"],
            "attempt": finding["attempt"],
            "supported": supported,
            "unsupported": unsupported,
        }

    async def write(self, company: str, verdicts: list[Verdict], previous: dict | None) -> dict:
        self.calls.append(("write", company, 0))
        profile: dict = {"name": company}
        for verdict in verdicts:
            for claim in verdict["supported"]:
                profile[claim["field"]] = claim["value"]
        return profile
