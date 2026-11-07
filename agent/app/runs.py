"""Run lifecycle: start, resume, approve, and the runs table that tracks it.

Each request drives the graph until it finishes or pauses at the approval
interrupt. A request holds the run with a lease, so two requests can't drive
the same run at once; a run whose request was cut off keeps status
'running' with a lease that runs out, and then it can be resumed.
"""

from datetime import datetime
from uuid import uuid4

from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command
from psycopg_pool import AsyncConnectionPool

from app.profiles import company_key
from app.state import Decision

# A little past the function's 300 s limit (maxDuration in vercel.json): a
# request that is still running holds the run until it has surely been cut.
LEASE_SECONDS = 330

ROW = """select id::text, company, status, error, created_at, updated_at,
                (status = 'failed' or (status = 'running' and lease_until < now())) as resumable
         from runs"""


class Runs:
    def __init__(
        self, pool: AsyncConnectionPool, graph: CompiledStateGraph, lease_seconds: float = LEASE_SECONDS
    ):
        self.pool = pool
        self.graph = graph
        self.lease_seconds = lease_seconds

    async def start(self, company: str, run_id: str | None = None) -> dict:
        run_id = run_id or str(uuid4())
        key = company_key(company)
        async with self.pool.connection() as conn:
            await conn.execute(
                """insert into runs (id, company, company_key, lease_until)
                   values (%s, %s, %s, now() + make_interval(secs => %s))""",
                (run_id, company, key, self.lease_seconds),
            )
        return await self._drive(
            run_id, {"company": company, "company_key": key, "findings": [], "verdicts": []}
        )

    async def resume(self, run_id: str) -> dict | None:
        """Continues a failed or cut-off run; None if it isn't resumable now."""
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
            await self._finish(run_id, "failed", f"{type(err).__name__}: {err}"[:1000])
        else:
            snapshot = await self.graph.aget_state(config)
            if snapshot.interrupts:
                status = "awaiting_approval"
            elif snapshot.values.get("decision", {}).get("action") == "reject":
                status = "rejected"
            else:
                status = "saved"
            await self._finish(run_id, status, None)
        run = await self.get(run_id)
        assert run is not None
        return run

    async def _finish(self, run_id: str, status: str, error: str | None) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                """update runs set status = %s, error = %s, lease_until = null, updated_at = now()
                   where id = %s""",
                (status, error, run_id),
            )

    @staticmethod
    def _config(run_id: str) -> dict:
        return {"configurable": {"thread_id": run_id}}


def iso(value: datetime) -> str:
    return value.isoformat()


def view(row: dict, values: dict, next_nodes: tuple[str, ...]) -> dict:
    """What the API returns for a run: the row plus a summary of its state."""
    previous = values.get("previous")
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
            }
            for v in values.get("verdicts", [])
        ],
        "draft": values.get("draft"),
        "previous_version": previous["version"] if previous else None,
        "saved_version": values.get("saved_version"),
    }
