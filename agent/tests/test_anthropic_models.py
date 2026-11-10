"""The Anthropic implementation against a scripted client: the request loop,
where sources come from, and what gets counted. No network, no cost."""

from dataclasses import dataclass, field

import pytest
from anthropic.types import Message, Usage

from app.anthropic_models import (
    CUT_OFF,
    NO_ANSWER,
    NUDGE,
    REQUESTS_PER_PASS,
    AnthropicModels,
    ModelConfig,
    PlanOutput,
    QuoteChecks,
)
from app.profile_schema import CompanyProfile, unknown_profile
from app.state import Finding, ResearchTask
from app.verify import NOT_SEEN, check_sources, normalize_url

SONNET = "claude-sonnet-5-5"
# Sonnet rates make the cost assertions easy to check by hand.
CONFIG = ModelConfig(researcher=SONNET, writer=SONNET)


def message(
    content: list[dict],
    stop_reason: str,
    *,
    searches: int = 0,
    fetches: int = 0,
    cache_write: int = 0,
    cache_read: int = 0,
    **extra,
) -> Message:
    return Message.model_validate(
        {
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": SONNET,
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {
                "input_tokens": 10_000,
                "output_tokens": 1_000,
                "cache_creation_input_tokens": cache_write,
                "cache_read_input_tokens": cache_read,
                "server_tool_use": {"web_search_requests": searches, "web_fetch_requests": fetches},
            },
            **extra,
        }
    )


def search_result(*urls: str) -> list[dict]:
    return [
        {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {"query": "q"}},
        {
            "type": "web_search_tool_result",
            "tool_use_id": "srvtoolu_1",
            "content": [
                {"type": "web_search_result", "url": u, "title": u, "encrypted_content": "x"} for u in urls
            ],
        },
    ]


def fetch_result(url: str) -> list[dict]:
    return [
        {"type": "server_tool_use", "id": "srvtoolu_2", "name": "web_fetch", "input": {"url": url}},
        {
            "type": "web_fetch_tool_result",
            "tool_use_id": "srvtoolu_2",
            "content": {
                "type": "web_fetch_result",
                "url": url,
                "content": {
                    "type": "document",
                    "source": {"type": "text", "media_type": "text/plain", "data": "page text"},
                },
            },
        },
    ]


def report(*claims: dict) -> list[dict]:
    return [
        {"type": "tool_use", "id": "toolu_1", "name": "report_findings", "input": {"claims": list(claims)}}
    ]


def claim(field: str, value: str, url: str) -> dict:
    return {"field": field, "value": value, "source_url": url, "quote": value}


@dataclass
class Parsed:
    """Enough of a ParsedMessage for the planner and writer."""

    parsed_output: object
    model: str = SONNET
    stop_reason: str = "end_turn"
    usage: Usage = field(default_factory=lambda: Usage(input_tokens=2_000, output_tokens=500))


class ScriptedClient:
    def __init__(self, created: list[Message] = (), parsed: list[Parsed] = ()):
        self.created = list(created)
        self.parsed = list(parsed)
        self.requests: list[dict] = []
        self.messages = self

    async def create(self, **request):
        # Copy the message list: the caller keeps appending to it.
        self.requests.append(request | {"messages": list(request["messages"])})
        return self.created.pop(0)

    async def parse(self, **request):
        self.requests.append(request)
        return self.parsed.pop(0)


def task(**changes) -> ResearchTask:
    return {
        "company": "Acme",
        "branch": "business",
        "hints": ["acme company"],
        "attempt": 1,
        "retry_claims": [],
    } | changes


async def test_research_collects_tool_urls_follows_pause_turn_and_returns_the_report():
    client = ScriptedClient(
        created=[
            message(
                search_result("https://acme.com/", "https://news.example/acme"),
                "pause_turn",
                searches=1,
                container={"id": "container_1", "expires_at": "2026-11-08T00:00:00Z"},
            ),
            message(
                fetch_result("https://acme.com/about")
                + report(
                    claim("website", "acme.com", "https://acme.com/"),
                    claim("founded_year", "1999", "https://made.up/"),
                ),
                "tool_use",
                fetches=1,
            ),
        ]
    )
    finding, usage = await AnthropicModels(client, CONFIG).research(task())

    assert finding["sources"] == ["https://acme.com/", "https://news.example/acme", "https://acme.com/about"]
    assert [c["field"] for c in finding["claims"]] == ["website", "founded_year"]
    # The paused turn was sent back as-is, in the same container.
    second = client.requests[1]
    assert second["container"] == "container_1"
    assert second["messages"][-1]["role"] == "assistant"
    [u] = usage
    assert (u["node"], u["branch"], u["attempt"], u["model"], u["effort"]) == (
        "researcher",
        "business",
        1,
        SONNET,
        "medium",
    )
    assert (u["requests"], u["web_search_requests"], u["web_fetch_requests"]) == (2, 1, 1)
    # 2 x (10k in at $2 + 1k out at $10 per MTok) + 1 search at $0.01.
    assert u["cost_usd"] == pytest.approx(2 * (0.02 + 0.01) + 0.01)
    # A claim citing a page the tools never returned is not supported.
    verdict = check_sources(finding)
    assert [c["field"] for c in verdict["supported"]] == ["website"]
    assert [c["field"] for c in verdict["unsupported"]] == ["founded_year"]


async def test_research_records_the_errors_the_web_tools_returned():
    failed = [
        {"type": "server_tool_use", "id": "srvtoolu_9", "name": "web_search", "input": {"query": "q"}},
        {
            "type": "web_search_tool_result",
            "tool_use_id": "srvtoolu_9",
            "content": {"type": "web_search_tool_result_error", "error_code": "too_many_requests"},
        },
    ]
    client = ScriptedClient(created=[message(failed + report(), "tool_use")])
    finding, _ = await AnthropicModels(client, CONFIG).research(task())

    assert finding["tool_errors"] == ['web_search: too_many_requests {"query": "q"}']
    assert finding["sources"] == []


async def test_research_caches_the_shared_prefix_and_counts_what_caching_saved():
    client = ScriptedClient(created=[message(report(), "tool_use", cache_write=20_000, cache_read=30_000)])
    _, [u] = await AnthropicModels(client, CONFIG).research(task())

    request = client.requests[0]
    # One breakpoint after the shared tools and system prompt, one automatic
    # one at the end of the conversation.
    assert request["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert request["cache_control"] == {"type": "ephemeral"}
    assert (u["cache_creation_input_tokens"], u["cache_read_input_tokens"]) == (20_000, 30_000)
    # Sonnet 5.5: 10k in at $2, 20k written at $2.50, 30k read at $0.10, 1k out at $10.
    assert u["cost_usd"] == pytest.approx(0.02 + 0.05 + 0.003 + 0.01)
    # Uncached, all 60k prompt tokens would have been $2 input.
    assert u["uncached_cost_usd"] == pytest.approx(0.12 + 0.01)


async def test_research_asks_again_when_the_model_stops_without_reporting():
    client = ScriptedClient(
        created=[
            message([{"type": "text", "text": "Done researching."}], "end_turn"),
            message(report(), "tool_use"),
        ]
    )
    finding, usage = await AnthropicModels(client, CONFIG).research(task())

    assert client.requests[1]["messages"][-1] == {"role": "user", "content": NUDGE}
    assert finding["claims"] == [] and usage[0]["requests"] == 2


async def test_a_report_cut_off_at_the_output_limit_is_answered_and_asked_for_again():
    cut_off = {"type": "tool_use", "id": "toolu_cut", "name": "report_findings", "input": {}}
    client = ScriptedClient(
        created=[
            message(search_result("https://acme.com/") + [cut_off], "max_tokens"),
            message(report(claim("website", "acme.com", "https://acme.com/")), "tool_use"),
        ]
    )
    finding, usage = await AnthropicModels(client, CONFIG).research(task())

    *_, assistant, answer = client.requests[1]["messages"]
    assert assistant["role"] == "assistant"
    assert answer["content"] == [
        {"type": "tool_result", "tool_use_id": "toolu_cut", "is_error": True, "content": CUT_OFF}
    ]
    assert [c["field"] for c in finding["claims"]] == ["website"] and usage[0]["requests"] == 2


async def test_research_gives_up_after_the_request_cap_with_no_claims():
    client = ScriptedClient(
        created=[message(search_result("https://acme.com/"), "pause_turn")] * REQUESTS_PER_PASS
    )
    finding, usage = await AnthropicModels(client, CONFIG).research(task())

    assert finding["claims"] == [] and finding["sources"] == ["https://acme.com/"]
    assert usage[0]["requests"] == REQUESTS_PER_PASS


async def test_a_retry_pass_names_the_claims_that_failed_and_why():
    failed = claim("founded_year", "1999", "https://made.up/") | {"check": "source", "reason": NOT_SEEN}
    client = ScriptedClient(created=[message(report(), "tool_use")])
    await AnthropicModels(client, CONFIG).research(task(attempt=2, retry_claims=[failed]))

    prompt = client.requests[0]["messages"][0]["content"]
    assert "second pass" in prompt
    assert f"founded_year: 1999 (https://made.up/). Rejected because {NOT_SEEN}" in prompt


async def test_a_retry_after_a_pass_with_no_claims_says_so():
    client = ScriptedClient(created=[message(report(), "tool_use")])
    await AnthropicModels(client, CONFIG).research(task(attempt=2))

    assert "the first pass reported no claims" in client.requests[0]["messages"][0]["content"]


def finding(*claims: dict, sources: list[str]) -> Finding:
    return {"branch": "business", "attempt": 1, "claims": list(claims), "sources": sources}


async def test_the_verifier_asks_the_model_only_about_claims_from_pages_the_run_saw():
    website = claim("website", "acme.com", "https://acme.com/")
    founded = claim("founded_year", "1999", "https://acme.com/about") | {"quote": "Acme was founded in 1999"}
    hq = claim("hq_location", "Austin, Texas, USA (1 Main St)", "https://acme.com/about")
    made_up = claim("employee_count", "51-200", "https://made.up/")
    checks = QuoteChecks.model_validate(
        {
            "checks": [
                {"claim": 0, "supported": True, "reason": ""},
                {"claim": 1, "supported": True, "reason": ""},
                {"claim": 2, "supported": False, "reason": "the street address isn't in the quote"},
            ]
        }
    )
    client = ScriptedClient(parsed=[Parsed(checks)])

    verdict, [u] = await AnthropicModels(client, CONFIG).verify(
        finding(website, founded, hq, made_up, sources=["https://acme.com/", "https://acme.com/about"])
    )

    sent = client.requests[0]["messages"][0]["content"]
    assert "Acme was founded in 1999" in sent and "made.up" not in sent
    assert client.requests[0]["output_format"] is QuoteChecks
    assert verdict["supported"] == [website, founded]
    assert [(c["field"], c["check"], c["reason"]) for c in verdict["unsupported"]] == [
        ("employee_count", "source", NOT_SEEN),
        ("hq_location", "quote", "the quote doesn't support it (the street address isn't in the quote)"),
    ]
    assert (u["node"], u["branch"], u["model"], u["effort"]) == (
        "verifier",
        "business",
        "claude-haiku-5-5",
        "low",
    )


async def test_a_claim_the_checker_leaves_out_or_refuses_is_unsupported():
    claims = [
        claim("website", "acme.com", "https://acme.com/"),
        claim("industry", "Software", "https://acme.com/"),
    ]
    sources = ["https://acme.com/"]
    partial = QuoteChecks.model_validate({"checks": [{"claim": 0, "supported": True, "reason": ""}]})
    client = ScriptedClient(parsed=[Parsed(partial), Parsed(None, stop_reason="refusal")])
    models = AnthropicModels(client, CONFIG)

    verdict, _ = await models.verify(finding(*claims, sources=sources))
    assert [c["field"] for c in verdict["supported"]] == ["website"]
    assert [(c["field"], c["reason"]) for c in verdict["unsupported"]] == [("industry", NO_ANSWER)]

    refused, _ = await models.verify(finding(*claims, sources=sources))
    assert refused["supported"] == [] and len(refused["unsupported"]) == 2


async def test_the_verifier_skips_the_model_when_no_url_checks_out():
    client = ScriptedClient()
    verdict, usage = await AnthropicModels(client, CONFIG).verify(
        finding(claim("website", "acme.com", "https://made.up/"), sources=[])
    )

    assert usage == [] and client.requests == [] and len(verdict["unsupported"]) == 1


async def test_the_plan_drops_repeats_and_falls_back_to_every_branch():
    planned = PlanOutput.model_validate(
        {"branches": [{"branch": "news", "hints": ["a", "b", "c", "d"]}, {"branch": "news", "hints": []}]}
    )
    client = ScriptedClient(parsed=[Parsed(planned), Parsed(None, stop_reason="refusal")])
    models = AnthropicModels(client, CONFIG)

    plan, usage = await models.plan("Acme", None)
    assert plan == [{"branch": "news", "hints": ["a", "b", "c"]}]
    assert (usage[0]["node"], usage[0]["model"], usage[0]["effort"]) == ("planner", "claude-haiku-5-5", "low")
    fallback, _ = await models.plan("Acme", None)
    assert [p["branch"] for p in fallback] == ["business", "funding", "leadership", "news"]


async def test_the_writer_sees_claims_not_quotes_and_code_adds_the_sources():
    supported = [claim("website", "acme.com", "https://acme.com/")]
    verdicts = [{"branch": "business", "attempt": 1, "supported": supported, "unsupported": []}]
    # The writer also fills in an industry that no claim backs.
    written = CompanyProfile(
        **(unknown_profile("Acme").model_dump() | {"website": "acme.com", "industry": "Software"})
    )
    client = ScriptedClient(parsed=[Parsed(written)])

    draft, usage = await AnthropicModels(client, CONFIG).write("Acme", verdicts, None)

    sent = client.requests[0]["messages"][0]["content"]
    assert "https://acme.com/" in sent and '"quote"' not in sent
    assert client.requests[0]["output_format"] is CompanyProfile
    assert draft["website"] == "acme.com" and draft["sources"] == {"website": ["https://acme.com/"]}
    # Output validation: a field no supported claim backs goes back to unknown.
    assert draft["industry"] == "unknown"
    assert usage[0]["node"] == "writer"


async def test_the_writer_sees_the_saved_facts_and_keeps_the_ones_not_found_again():
    supported = [claim("website", "acme.com", "https://acme.com/")]
    verdicts = [{"branch": "business", "attempt": 1, "supported": supported, "unsupported": []}]
    previous = unknown_profile("Acme").model_dump() | {
        "website": "acme.com",
        "founded_year": "1999",
        "sources": {"founded_year": ["https://saved.example/"]},
        "carried_over": [],
    }
    written = CompanyProfile(**(unknown_profile("Acme").model_dump() | {"website": "acme.com"}))
    client = ScriptedClient(parsed=[Parsed(written)])

    draft, _ = await AnthropicModels(client, CONFIG).write("Acme", verdicts, previous)

    sent = client.requests[0]["messages"][0]["content"]
    assert "Previous profile" in sent and '"founded_year": "1999"' in sent
    # The models see facts, not what code added to them.
    assert "saved.example" not in sent and "carried_over" not in sent
    assert draft["founded_year"] == "1999" and draft["carried_over"] == ["founded_year"]


async def test_the_planner_sees_the_saved_version_and_its_date():
    planned = PlanOutput.model_validate({"branches": [{"branch": "news", "hints": ["acme news"]}]})
    client = ScriptedClient(parsed=[Parsed(planned)])
    previous = {
        "version": 3,
        "saved_at": "2026-10-01T12:00:00+00:00",
        "profile": unknown_profile("Acme").model_dump()
        | {"sources": {"website": ["https://saved.example/"]}},
    }

    plan, _ = await AnthropicModels(client, CONFIG).plan("Acme", previous)

    sent = client.requests[0]["messages"][0]["content"]
    assert "version 3, saved 2026-10-01" in sent and "saved.example" not in sent
    assert plan == [{"branch": "news", "hints": ["acme news"]}]


async def test_the_writer_skips_the_model_when_nothing_was_verified():
    client = ScriptedClient()
    draft, usage = await AnthropicModels(client, CONFIG).write("Acme", [], None)

    assert draft["website"] == "unknown" and usage == [] and client.requests == []


async def test_the_search_limit_reaches_the_tool_and_the_prompt():
    client = ScriptedClient(created=[message(report(), "tool_use")])
    await AnthropicModels(client, ModelConfig(searches=1)).research(task())

    request = client.requests[0]
    [search] = [t for t in request["tools"] if t["name"] == "web_search"]
    assert search["max_uses"] == 1
    # Every tool's input is schema-checked, the web tools' included.
    assert all(t["strict"] for t in request["tools"])
    assert "at most 1 searches" in request["system"][0]["text"]


def test_a_model_without_a_price_is_refused():
    with pytest.raises(ValueError, match="no price"):
        ModelConfig(researcher="claude-retired-model")


@pytest.mark.parametrize(
    "a, b",
    [
        ("https://www.Acme.com/about/", "http://acme.com/about"),
        ("https://acme.com/#team", "https://acme.com"),
    ],
)
def test_urls_that_name_the_same_page_match(a, b):
    assert normalize_url(a) == normalize_url(b)


def test_a_different_query_is_a_different_page():
    assert normalize_url("https://acme.com/?p=1") != normalize_url("https://acme.com/?p=2")
