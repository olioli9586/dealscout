"""Langfuse tracing, against an in-memory span exporter: the spans a run
makes, what a generation records, and that it's all off without keys. No
network."""

import json

import pytest
from langfuse import Langfuse
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app import tracing
from app.anthropic_models import AnthropicModels
from tests.test_anthropic_models import CONFIG, ScriptedClient, claim, message, report, search_result, task
from tests.test_edgar import FILING_URL, fake_edgar

EXPORTER = InMemorySpanExporter()


@pytest.fixture(scope="session")
def langfuse() -> Langfuse:
    # One client for the session: Langfuse keeps one span processor per key.
    keys = {"public_key": "pk-lf-test", "secret_key": "sk-lf-test"}
    return Langfuse(**keys, base_url="http://127.0.0.1:9", span_exporter=EXPORTER)


@pytest.fixture
def spans(langfuse, monkeypatch):
    """Turns tracing on; returns a function giving the finished spans."""
    monkeypatch.setattr(tracing, "client", lambda: langfuse)
    EXPORTER.clear()

    def finished() -> list:
        langfuse.flush()
        return list(EXPORTER.get_finished_spans())

    return finished


def attrs(span) -> dict:
    """The span's Langfuse attributes, JSON values decoded."""
    out = {}
    for key, value in span.attributes.items():
        key = key.removeprefix("langfuse.observation.")
        try:
            out[key] = json.loads(value) if isinstance(value, str) else value
        except json.JSONDecodeError:
            out[key] = value
    return out


def test_tracing_is_off_without_keys(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    tracing.client.cache_clear()
    try:
        assert tracing.client() is None
        with tracing.run_trace("0b6f3b5e-6a4e-4a8e-9a43-3f1e2d9c7b10", "Acme", "start"):
            with tracing.observation("planner") as span:
                span.update(output={"anything": 1})
        with tracing.generation({"model": "m", "messages": [{"role": "user", "content": "x"}]}) as record:
            record(None)
        tracing.flush()
    finally:
        tracing.client.cache_clear()


async def test_a_request_is_a_generation_with_its_usage_and_our_cost(spans):
    client = ScriptedClient(
        created=[
            message(
                search_result("https://acme.com/")
                + report(claim("website", "acme.com", "https://acme.com/")),
                "tool_use",
                searches=1,
                cache_read=500,
            )
        ]
    )
    await AnthropicModels(client, CONFIG).research(task())

    [generation] = spans()
    a = attrs(generation)
    assert a["type"] == "generation"
    assert a["model.name"] == "claude-sonnet-5-5"
    assert a["model.parameters"] == {"max_tokens": 8000, "effort": "medium"}
    assert a["usage_details"]["input"] == 10_000
    assert a["usage_details"]["cache_read_input_tokens"] == 500
    assert a["usage_details"]["web_search_requests"] == 1
    # 10k in at $2, 500 cached at $0.10, 1k out at $10 per MTok, one search at $0.01.
    assert a["cost_details"]["total"] == pytest.approx(0.02 + 0.00005 + 0.01 + 0.01)
    assert a["input"]["content"].startswith("Today is")
    assert [c.get("tool") for c in a["output"]["content"]] == ["web_search", "report_findings"]


async def test_an_edgar_call_is_a_tool_span(spans):
    client = ScriptedClient(
        created=[
            message(
                [
                    {
                        "type": "tool_use",
                        "id": "toolu_e1",
                        "name": "secedgar_get_filing",
                        "input": {"accession_number": "0001803782-26-000003"},
                    }
                ],
                "tool_use",
            ),
            message(report(), "tool_use"),
        ]
    )
    await AnthropicModels(client, CONFIG, edgar_server=fake_edgar()).research(task(branch="funding"))

    finished = spans()
    [tool] = [s for s in finished if attrs(s).get("type") == "tool"]
    assert tool.name == "secedgar_get_filing"
    assert attrs(tool)["input"] == {"accession_number": "0001803782-26-000003"}
    assert FILING_URL in attrs(tool)["output"]
    # The MCP SDK's own span for the protocol call (Langfuse keeps gen_ai
    # spans) sits under it.
    [protocol] = [s for s in finished if s.instrumentation_scope.name == "mcp-python-sdk"]
    assert protocol.name == "tools/call secedgar_get_filing"
    assert protocol.parent.span_id == tool.context.span_id


async def test_a_run_is_one_trace_across_its_requests_with_a_span_per_node(spans, make_runs):
    runs, _ = make_runs()
    run = await runs.start("Acme")
    await runs.decide(run["id"], {"action": "approve"})

    finished = spans()
    trace_ids = {format(s.context.trace_id, "032x") for s in finished}
    assert trace_ids == {run["id"].replace("-", "")}
    roots = [s for s in finished if attrs(s).get("type") == "agent"]
    assert sorted(r.name for r in roots) == ["decision", "start"]
    by_id = {s.context.span_id: s for s in finished}
    children = {}
    for s in finished:
        if s.parent and s.parent.span_id in by_id:
            children.setdefault(by_id[s.parent.span_id].name, []).append(s.name)
    assert sorted(children["start"]) == sorted(
        ["load_memory", "planner", "verifier", "writer"]
        + [f"researcher: {b}" for b in ("business", "funding", "leadership", "news")]
    )
    assert children["decision"] == ["save"]
    assert attrs(roots[0])["langfuse.trace.name"] == "run: Acme"
