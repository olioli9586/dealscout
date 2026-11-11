"""The v2 research workflow as a LangGraph graph.

  load_memory -> planner -> researcher x N, in parallel (one Send per branch)
    -> verifier --a weak branch with a pass left--> researcher (that branch only)
                --otherwise--> writer -> approve (interrupt) -> save, or END on reject

Every node boundary is a checkpoint under the run's thread id, so a run that
is cut off resumes from its last finished step, and researchers that had
already finished in that step aren't run again (their writes are stored as
the step's pending writes).

The run budget (state["budget_usd"]) is checked where the graph decides to
do more research: before the fan-out, and before each retry, using what that
branch's last pass cost as the estimate for the next. The writer always
runs, so a run that hits its budget still ends with a draft. One research
step can overshoot the budget; each researcher's own limits (web tool
max_uses, a request cap) bound by how much.
"""

import asyncio

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send, interrupt

from app import tracing
from app.models import Models
from app.profiles import ProfileStore
from app.state import (
    MAX_ATTEMPTS,
    SUPPORT_BAR,
    ResearchTask,
    RunState,
    Usage,
    Verdict,
    latest_per_branch,
    spent,
)


def support(verdict: Verdict) -> float:
    total = len(verdict["supported"]) + len(verdict["unsupported"])
    return len(verdict["supported"]) / total if total else 0.0


def pass_cost(usage: list[Usage], branch: str, attempt: int) -> float:
    """What one researcher pass cost (infinite if unknown)."""
    return spent(
        [u for u in usage if u["node"] == "researcher" and (u["branch"], u["attempt"]) == (branch, attempt)]
    )


def build_graph(models: Models, profiles: ProfileStore, checkpointer: BaseCheckpointSaver):
    async def load_memory(state: RunState) -> dict:
        with tracing.observation("load_memory") as span:
            previous = await profiles.latest(state["company_key"])
            span.update(output={"previous_version": previous["version"] if previous else None})
        return {"previous": previous}

    async def planner(state: RunState) -> dict:
        with tracing.observation("planner") as span:
            plan, usage = await models.plan(state["company"], state.get("previous"))
            span.update(output=plan)
        return {"plan": plan, "usage": usage}

    def fan_out(state: RunState) -> list[Send] | str:
        if spent(state["usage"]) >= state["budget_usd"]:
            return "writer"
        sends = [
            Send(
                "researcher",
                ResearchTask(
                    company=state["company"],
                    branch=p["branch"],
                    hints=p["hints"],
                    attempt=1,
                    retry_claims=[],
                ),
            )
            for p in state["plan"]
        ]
        return sends or "writer"

    async def researcher(task: ResearchTask) -> dict:
        name = f"researcher: {task['branch']}" + (f" (pass {task['attempt']})" if task["attempt"] > 1 else "")
        with tracing.observation(
            name, metadata={"branch": task["branch"], "attempt": task["attempt"]}
        ) as span:
            finding, usage = await models.research(task)
            span.update(output=finding)
        return {"findings": [finding], "usage": usage}

    async def verifier(state: RunState) -> dict:
        checked = {(v["branch"], v["attempt"]) for v in state["verdicts"]}
        new = [
            f
            for f in latest_per_branch(state["findings"]).values()
            if (f["branch"], f["attempt"]) not in checked
        ]
        with tracing.observation("verifier") as span:
            results = await asyncio.gather(*(models.verify(f) for f in new))
            span.update(output=[v for v, _ in results])
        return {"verdicts": [v for v, _ in results], "usage": [u for _, usage in results for u in usage]}

    def after_verifier(state: RunState) -> list[Send] | str:
        hints = {p["branch"]: p["hints"] for p in state["plan"]}
        weak = sorted(
            (
                v
                for v in latest_per_branch(state["verdicts"]).values()
                if support(v) < SUPPORT_BAR and v["attempt"] < MAX_ATTEMPTS
            ),
            key=support,
        )
        # Weakest branches first, as many as the budget left can pay for.
        projected = spent(state["usage"])
        retries = []
        for v in weak:
            cost = pass_cost(state["usage"], v["branch"], v["attempt"])
            if projected + cost > state["budget_usd"]:
                continue
            projected += cost
            retries.append(
                Send(
                    "researcher",
                    ResearchTask(
                        company=state["company"],
                        branch=v["branch"],
                        hints=hints[v["branch"]],
                        attempt=v["attempt"] + 1,
                        retry_claims=v["unsupported"],
                    ),
                )
            )
        return retries or "writer"

    async def writer(state: RunState) -> dict:
        previous = state.get("previous")
        # Every pass, not just each branch's last: a retry adds claims, and
        # mustn't drop what the first pass verified.
        verdicts = state["verdicts"]
        with tracing.observation("writer") as span:
            draft, usage = await models.write(
                state["company"], verdicts, previous["profile"] if previous else None
            )
            span.update(output=draft)
        return {"draft": draft, "usage": usage}

    def approve(state: RunState) -> dict:
        # On resume this node runs again from the top, and interrupt() returns
        # the answer instead of pausing, so nothing may happen before it.
        # The API validated the decision before resuming with it.
        return {"decision": interrupt({"draft": state["draft"]})}

    def after_approve(state: RunState) -> str:
        return END if state["decision"]["action"] == "reject" else "save"

    async def save(state: RunState, config: RunnableConfig) -> dict:
        decision = state["decision"]
        profile = decision["profile"] if decision["action"] == "edit" else state["draft"]
        run_id = config["configurable"]["thread_id"]
        with tracing.observation("save", input={"action": decision["action"]}) as span:
            version = await profiles.save(run_id, state["company_key"], profile)
            span.update(output={"saved_version": version})
        return {"saved_version": version}

    graph = StateGraph(RunState)
    graph.add_node("load_memory", load_memory)
    graph.add_node("planner", planner)
    graph.add_node("researcher", researcher)
    graph.add_node("verifier", verifier)
    graph.add_node("writer", writer)
    graph.add_node("approve", approve)
    graph.add_node("save", save)
    graph.add_edge(START, "load_memory")
    graph.add_edge("load_memory", "planner")
    graph.add_conditional_edges("planner", fan_out, ["researcher", "writer"])
    graph.add_edge("researcher", "verifier")
    graph.add_conditional_edges("verifier", after_verifier, ["researcher", "writer"])
    graph.add_edge("writer", "approve")
    graph.add_conditional_edges("approve", after_approve, ["save", END])
    graph.add_edge("save", END)
    return graph.compile(checkpointer=checkpointer)
