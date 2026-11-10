"""Run lifecycle: start, resume, approve, and the runs table that tracks it.

Each request drives the graph until it finishes or pauses at the approval
interrupt. A request holds the run with a lease, so two requests can't drive
the same run at once; a run whose request was cut off keeps status
'running' with a lease that runs out, and then it can be resumed.

Spend has two limits: each run's own budget (enforced inside the graph, see
app/graph.py) and a daily cap over all runs, checked before a request starts
or resumes a run. The daily cap counts what finished requests recorded, so a
request in flight, or one cut off and not yet resumed, isn't counted yet,
and two requests that start together can both pass it: it bounds spend to
the cap plus the runs in flight.
"""

from datetime import datetime
from uuid import uuid4

from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command
from psycopg_pool import AsyncConnectionPool

from app.profile_schema import diff_profiles
from app.profiles import company_key
from app.state import Decision, Usage, spent

# A little past the function's 300 s limit (maxDuration in vercel.json): a
# request that is still running holds the run until it has surely been cut.
LEASE_SECONDS = 330
RUN_BUDGET_USD = 1.50

ROW = """select id::text, company, status, error, created_at, updated_at, budget_usd, cost_usd,
                (status = 'failed' or (status = 'running' and lease_until < now())) as resumable
         from runs"""


class SpendCapReached(Exception):
    """The runs of the last 24 hours have spent the daily cap."""


class Runs:
    def __init__(
        self,
        pool: AsyncConnectionPool,
        graph: CompiledStateGraph,
        lease_seconds: float = LEASE_SECONDS,
        run_budget_usd: float = RUN_BUDGET_USD,
        daily_usd: float | None = None,
    ):
        self.pool = pool
        self.graph = graph
        self.lease_seconds = lease_seconds
        self.run_budget_usd = run_budget_usd
        # None: no daily cap (the fakes cost nothing).
        self.daily_usd = daily_usd

    async def start(self, company: str, run_id: str | None = None) -> dict:
        """Raises SpendCapReached instead of starting past the daily cap."""
        await self._check_daily_cap()
        run_id = run_id or str(uuid4())
        key = company_key(company)
        async with self.pool.connection() as conn:
            await conn.execute(
                """insert into runs (id, company, company_key, budget_usd, lease_until)
                   values (%s, %s, %s, %s, now() + make_interval(secs => %s))""",
                (run_id, company, key, self.run_budget_usd, self.lease_seconds),
            )
        return await self._drive(
            run_id,
            {
                "company": company,
                "company_key": key,
                "budget_usd": self.run_budget_usd,
                "findings": [],
                "verdicts": [],
                "usage": [],
            },
        )

    async def resume(self, run_id: str) -> dict | None:
        """Continues a failed or cut-off run; None if it isn't resumable now.
        Raises SpendCapReached instead of resuming past the daily cap."""
        await self._check_daily_cap()
        if not await self._claim(run_id, "status = 'failed' or (status = 'running' and lease_until < now())"):
            return None
        return await self._drive(run_id, None)

    async def decide(self, run_id: str, decision: Decision) -> dict | None:
        """Answers the approval interrupt; None if the run isn't waiting for one."""
        if not await self._claim(run_id, "status = 'awaiting_approval'"):
            return None
        return await self._drive(run_id, Command(resume=decision))

    async def get(self, run_id: str) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(f"{ROW} where id = %s", (run_id,))).fetchone()
        if row is None:
            return None
        snapshot = await self.graph.aget_state(self._config(run_id))
        return view(row, snapshot.values, snapshot.next)

    async def spent_today(self) -> float:
        """USD recorded by runs started in the last 24 hours; infinite if any
        cost is unknown."""
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    """select coalesce(sum(cost_usd), 0) as total, bool_or(cost_usd is null) as unknown
                       from runs where created_at > now() - interval '24 hours'"""
                )
            ).fetchone()
        return float("inf") if row["unknown"] else row["total"]

    async def _check_daily_cap(self) -> None:
        if self.daily_usd is not None and await self.spent_today() >= self.daily_usd:
            raise SpendCapReached(f"the daily spend cap (${self.daily_usd:.2f}) is reached")

    async def _claim(self, run_id: str, condition: str) -> bool:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    f"""update runs set status = 'running', error = null, updated_at = now(),
                          lease_until = now() + make_interval(secs => %s)
                        where id = %s and ({condition}) returning id""",
                    (self.lease_seconds, run_id),
                )
            ).fetchone()
        return row is not None

    async def _drive(self, run_id: str, graph_input: dict | Command | None) -> dict:
        config = self._config(run_id)
        try:
            # "sync": each step's checkpoint is written before the next step
            # starts, so a run killed at any point loses at most the step in
            # progress (minus the branches of it that had finished).
            await self.graph.ainvoke(graph_input, config, durability="sync")
        except Exception as err:  # noqa: BLE001 (any node error leaves a resumable 'failed' run)
            snapshot = await self.graph.aget_state(config)
            await self._finish(run_id, "failed", f"{type(err).__name__}: {err}"[:1000], snapshot.values)
        else:
            snapshot = await self.graph.aget_state(config)
            if snapshot.interrupts:
                status = "awaiting_approval"
            elif snapshot.values.get("decision", {}).get("action") == "reject":
                status = "rejected"
            else:
                status = "saved"
            await self._finish(run_id, status, None, snapshot.values)
        run = await self.get(run_id)
        assert run is not None
        return run

    async def _finish(self, run_id: str, status: str, error: str | None, values: dict) -> None:
        cost = spent(values.get("usage", []))
        async with self.pool.connection() as conn:
            await conn.execute(
                """update runs set status = %s, error = %s, cost_usd = %s, lease_until = null,
                     updated_at = now()
                   where id = %s""",
                (status, error, None if cost == float("inf") else cost, run_id),
            )

    @staticmethod
    def _config(run_id: str) -> dict:
        return {"configurable": {"thread_id": run_id}}


def iso(value: datetime) -> str:
    return value.isoformat()


def summarize(usage: list[Usage]) -> dict:
    """Run totals, plus every node's entry, for the API and the eval."""
    total = spent(usage)
    keys = (
        "requests",
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "web_search_requests",
        "web_fetch_requests",
    )
    # An entry from before caching cost the same uncached.
    uncached = spent([{**u, "cost_usd": u.get("uncached_cost_usd", u["cost_usd"])} for u in usage])
    return {
        **{k: sum(u[k] for u in usage) for k in keys},
        "cost_usd": None if total == float("inf") else total,
        "uncached_cost_usd": None if uncached == float("inf") else uncached,
        "calls": usage,
    }


def view(row: dict, values: dict, next_nodes: tuple[str, ...]) -> dict:
    """What the API returns for a run: the row plus a summary of its state."""
    previous = values.get("previous")
    draft = values.get("draft")
    decision = values.get("decision", {})
    # What changed since the saved version this run started from: in the
    # draft, or in the edited profile once a person has edited it.
    current = decision["profile"] if decision.get("action") == "edit" else draft
    changes = diff_profiles(previous["profile"], current) if previous and current else None
    return {
        "id": row["id"],
        "company": row["company"],
        "status": row["status"],
        "resumable": row["resumable"],
        "error": row["error"],
        "created_at": iso(row["created_at"]),
        "updated_at": iso(row["updated_at"]),
        "next": list(next_nodes),
        "plan": [p["branch"] for p in values.get("plan", [])],
        "findings": [
            {"branch": f["branch"], "attempt": f["attempt"], "claims": len(f["claims"])}
            for f in values.get("findings", [])
        ],
        "verdicts": [
            {
                "branch": v["branch"],
                "attempt": v["attempt"],
                "supported": len(v["supported"]),
                "unsupported": len(v["unsupported"]),
                # Day 3 verdicts have no check or reason: only the source check existed.
                "rejected": [
                    {
                        "field": c["field"],
                        "value": c["value"],
                        "source_url": c["source_url"],
                        "check": c.get("check", "source"),
                        "reason": c.get("reason"),
                    }
                    for c in v["unsupported"]
                ],
            }
            for v in values.get("verdicts", [])
        ],
        "draft": draft,
        "previous_version": previous["version"] if previous else None,
        "changes": changes,
        "saved_version": values.get("saved_version"),
        "budget_usd": row["budget_usd"],
        "usage": summarize(values.get("usage", [])),
    }
