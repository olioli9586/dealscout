"""Langfuse tracing: one trace per run, a span per graph node, a generation
per model request and a tool span per EDGAR call.

Off unless LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set
(LANGFUSE_BASE_URL picks the region). Off, every helper is a no-op and no
Langfuse client is built.

A run's trace id is its run id, so a resume or the approval step (a later
request) adds to the same trace. Generations carry the cost from
app/pricing.py, which knows the models and the web search fee, instead of
Langfuse's own price table. They record the request's newest message and
the response's text and tool calls, not the whole conversation each time.
"""

import os
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import cache
from typing import Any

from anthropic.types import Message

from app.pricing import PRICES, response_cost

TEXT_LIMIT = 4_000


@cache
def client() -> Any:
    """The Langfuse client, or None when the keys aren't set."""
    if not (os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY")):
        return None
    from langfuse import Langfuse

    return Langfuse()


def flush() -> None:
    """Sends what's buffered. Blocking: call it in a thread."""
    if (langfuse := client()) is not None:
        langfuse.flush()


class _Off:
    def update(self, **_: Any) -> None:
        pass


@contextmanager
def run_trace(run_id: str, company: str, step: str) -> Iterator[None]:
    """One request's work on a run (step: start, resume or decision), in the run's trace."""
    langfuse = client()
    if langfuse is None:
        yield
        return
    from langfuse import propagate_attributes

    trace = {"trace_id": uuid.UUID(run_id).hex}
    with (
        langfuse.start_as_current_observation(trace_context=trace, name=step, as_type="agent"),
        propagate_attributes(trace_name=f"run: {company}", session_id=run_id, metadata={"company": company}),
    ):
        yield


@contextmanager
def observation(name: str, as_type: str = "span", **fields: Any) -> Iterator[Any]:
    """A span (a graph node) or a tool call under the current observation;
    yields something with update(output=..., level=...)."""
    langfuse = client()
    if langfuse is None:
        yield _Off()
        return
    with langfuse.start_as_current_observation(name=name, as_type=as_type, **fields) as span:
        yield span


@contextmanager
def generation(request: dict) -> Iterator[Callable[[Message], None]]:
    """One model request; yields a function that records its response."""
    langfuse = client()
    if langfuse is None:
        yield lambda _response: None
        return
    parameters = {"max_tokens": request.get("max_tokens"), **request.get("output_config", {})}
    with langfuse.start_as_current_observation(
        name="messages",
        as_type="generation",
        model=request["model"],
        model_parameters=parameters,
        input=newest_message(request["messages"]),
    ) as span:

        def record(response: Message) -> None:
            # Priced like Meter.add: what ran, or what was asked for.
            model = response.model if response.model in PRICES else request["model"]
            cost = response_cost(model, response.usage)
            span.update(
                model=response.model,
                output=response_output(response),
                usage_details=usage_details(response),
                cost_details=None if cost is None else {"total": cost},
            )

        yield record


class TracedMessages:
    """client.messages with a generation around each create and parse."""

    def __init__(self, messages: Any):
        self._messages = messages

    async def create(self, **request: Any) -> Any:
        with generation(request) as record:
            response = await self._messages.create(**request)
            record(response)
            return response

    async def parse(self, **request: Any) -> Any:
        with generation(request) as record:
            response = await self._messages.parse(**request)
            record(response)
            return response


class TracedClient:
    def __init__(self, client: Any):
        self.messages = TracedMessages(client.messages)


def cut(text: str) -> str:
    return text if len(text) <= TEXT_LIMIT else text[:TEXT_LIMIT] + f" [cut at {TEXT_LIMIT} characters]"


def newest_message(messages: list[dict]) -> dict:
    """The message this request adds: the task, an EDGAR result or a nudge.
    (Earlier turns are in the earlier generations.)"""
    message = messages[-1]
    content = message["content"]
    if isinstance(content, str):
        return {"role": message["role"], "turn": len(messages), "content": cut(content)}
    blocks = [
        {"type": b.get("type"), "is_error": b.get("is_error"), "content": cut(str(b.get("content", "")))}
        if isinstance(b, dict)
        else {"type": getattr(b, "type", None)}
        for b in content
    ]
    return {"role": message["role"], "turn": len(messages), "content": blocks}


def response_output(response: Message) -> dict:
    """The text and the tool calls (search queries, EDGAR calls, the report);
    result blocks are left out (web search results are encrypted anyway)."""
    content: list[dict] = []
    for block in response.content:
        if block.type == "text":
            content.append({"text": cut(block.text)})
        elif block.type in ("tool_use", "server_tool_use"):
            content.append({"tool": block.name, "input": block.input})
    return {"stop_reason": response.stop_reason, "content": content}


def usage_details(response: Message) -> dict[str, int]:
    usage = response.usage
    details = {
        "input": usage.input_tokens,
        "output": usage.output_tokens,
        "cache_read_input_tokens": usage.cache_read_input_tokens or 0,
        "cache_creation_input_tokens": usage.cache_creation_input_tokens or 0,
    }
    if usage.server_tool_use:
        details["web_search_requests"] = usage.server_tool_use.web_search_requests
        details["web_fetch_requests"] = usage.server_tool_use.web_fetch_requests
    return details
