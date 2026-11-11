"""What a model call costs, from the usage the API reports on each response.

A port of lib/pricing.ts (the v1 table), so v1 and v2 runs are priced the
same way. USD per million tokens, from
https://platform.claude.com/docs/en/about-claude/pricing (checked
2026-11-08). Cache writes are priced at the 5-minute rate, the only cache
duration DealScout uses. Web fetch and the code execution that the _20260209
web tools run for dynamic filtering cost nothing beyond tokens; web search
is $10 per 1,000 searches on top of its tokens.
"""

from typing import NamedTuple, Protocol


class Rates(NamedTuple):
    input: float
    cache_write: float
    cache_read: float
    output: float


PRICES: dict[str, Rates] = {
    "claude-opus-5-5": Rates(4, 5, 0.2, 20),
    "claude-sonnet-5-5": Rates(2, 2.5, 0.1, 10),
    "claude-haiku-5-5": Rates(0.1, 0.125, 0.01, 0.5),
    "claude-opus-4-8": Rates(5, 6.25, 0.5, 25),
    "claude-sonnet-4-6": Rates(3, 3.75, 0.3, 15),
}

# Haiku 5.5 has a second rate card for prompts over 100,000 tokens.
HAIKU_LONG = Rates(0.5, 0.625, 0.05, 2.5)
HAIKU_LONG_AFTER = 100_000

WEB_SEARCH_USD = 0.01


class ServerToolUsage(Protocol):
    web_search_requests: int
    web_fetch_requests: int


class ResponseUsage(Protocol):
    """The usage fields of one Messages API response that cost money."""

    input_tokens: int
    output_tokens: int
    cache_creation_input_tokens: int | None
    cache_read_input_tokens: int | None
    server_tool_use: ServerToolUsage | None


def response_cost(model: str, usage: ResponseUsage, *, uncached: bool = False) -> float | None:
    """Cost of one response in USD, or None for a model with no known price.

    uncached=True prices the same response as if nothing had been cached
    (every prompt token at the input rate): caching doesn't change what the
    model does, so the difference is exactly what caching saved."""
    rates = PRICES.get(model)
    if rates is None:
        return None
    cache_write = usage.cache_creation_input_tokens or 0
    cache_read = usage.cache_read_input_tokens or 0
    prompt = usage.input_tokens + cache_write + cache_read
    if model == "claude-haiku-5-5" and prompt > HAIKU_LONG_AFTER:
        rates = HAIKU_LONG
    if uncached:
        rates = rates._replace(cache_write=rates.input, cache_read=rates.input)
    tokens = (
        usage.input_tokens * rates.input
        + cache_write * rates.cache_write
        + cache_read * rates.cache_read
        + usage.output_tokens * rates.output
    )
    searches = usage.server_tool_use.web_search_requests if usage.server_tool_use else 0
    return tokens / 1_000_000 + searches * WEB_SEARCH_USD
