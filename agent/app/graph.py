"""The v2 research workflow as a LangGraph graph.

  load_memory -> planner -> researcher x N, in parallel (one Send per branch)
    -> verifier --a weak branch with a pass left--> researcher (that branch only)
                --otherwise--> writer -> approve (interrupt) -> save, or END on reject

Every node boundary is a checkpoint under the run's thread id, so a run that
is cut off resumes from its last finished step, and researchers that had
already finished in that step aren't run again (their writes are stored as
the step's pending writes).
"""

import asyncio

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send, interrupt

from app.models import Models
from app.profiles import ProfileStore
from app.state import MAX_ATTEMPTS, SUPPORT_BAR, ResearchTask, RunState, Verdict, latest_per_branch


def support(verdict: Verdict) -> float:
    total = len(verdict["supported"]) + len(verdict["unsupported"])
    return len(verdict["supported"]) / total if total else 0.0


def build_graph(models: Models, profiles: ProfileStore, checkpointer: BaseCheckpointSaver):
    async def load_memory(state: RunState) -> dict:
        return {"previous": await profiles.latest(state["company_key"])}

    async def planner(state: RunState) -> dict:
        previous = state.get("previous")
        return {"plan": await models.plan(state["company"], previous["profile"] if previous else None)}

    def fan_out(state: RunState) -> list[Send] | str:
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
        return {"findings": [await models.research(task)]}

    async def verifier(state: RunState) -> dict:
        checked = {(v["branch"], v["attempt"]) for v in state["verdicts"]}
        new = [
            f
            for f in latest_per_branch(state["findings"]).values()
            if (f["branch"], f["attempt"]) not in checked
        ]
        return {"verdicts": list(await asyncio.gather(*(models.verify(f) for f in new)))}

    def after_verifier(state: RunState) -> list[Send] | str:
        hints = {p["branch"]: p["hints"] for p in state["plan"]}
        retries = [
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
            for v in latest_per_branch(state["verdicts"]).values()
            if support(v) < SUPPORT_BAR and v["attempt"] < MAX_ATTEMPTS
        ]
        return retries or "writer"

    async def writer(state: RunState) -> dict:
        previous = state.get("previous")
        verdicts = list(latest_per_branch(state["verdicts"]).values())
        return {
            "draft": await models.write(state["company"], verdicts, previous["profile"] if previous else None)
        }

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
        return {"saved_version": await profiles.save(run_id, state["company_key"], profile)}

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
