"""The same cases as lib/__tests__/pricing.test.ts, so both tables agree."""

import pytest
from anthropic.types import ServerToolUsage, Usage

from app.pricing import response_cost


def test_prices_every_token_kind_and_each_web_search():
    # Sonnet 4.6: $3 in, $3.75 cache write, $0.30 cache read, $15 out per MTok.
    usage = Usage(
        input_tokens=100_000,
        output_tokens=2_000,
        cache_creation_input_tokens=10_000,
        cache_read_input_tokens=50_000,
        server_tool_use=ServerToolUsage(web_search_requests=3, web_fetch_requests=2),
    )
    # 0.3 + 0.0375 + 0.015 + 0.03 tokens, plus 3 x $0.01 searches; fetches are free.
    assert response_cost("claude-sonnet-4-6", usage) == pytest.approx(0.4125, abs=1e-10)


def test_treats_missing_cache_and_tool_fields_as_zero():
    assert response_cost("claude-opus-5-5", Usage(input_tokens=1_000_000, output_tokens=0)) == 4


def test_switches_haiku_to_its_long_prompt_rates_past_100k_prompt_tokens():
    at = response_cost("claude-haiku-5-5", Usage(input_tokens=100_000, output_tokens=0))
    over = response_cost(
        "claude-haiku-5-5",
        Usage(input_tokens=90_000, cache_read_input_tokens=10_001, output_tokens=1_000),
    )
    assert at == pytest.approx(0.01, abs=1e-10)
    assert over == pytest.approx((90_000 * 0.5 + 10_001 * 0.05 + 1_000 * 2.5) / 1e6, abs=1e-10)


def test_is_none_for_a_model_it_has_no_price_for():
    assert response_cost("claude-retired-model", Usage(input_tokens=1, output_tokens=1)) is None
