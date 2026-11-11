"""The EDGAR MCP client against an in-process MCP server: which tools it
offers, the call limit, cut results and failures. No network."""

import pytest
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from app.edgar import CALLS_PER_PASS, RESULT_MAX_CHARS, TOOLS, Edgar, sec_urls

FILING_URL = "https://www.sec.gov/Archives/edgar/data/1803782/000180378226000003/xslFormDX01/primary_doc.xml"


def fake_edgar() -> MCPServer:
    server = MCPServer("fake-edgar")

    @server.tool()
    def secedgar_search_filings(query: str, forms: list[str] | None = None) -> str:
        """Search filings."""
        return f"- D 2026-10-16 — {query} Business Corp (CIK 0001803782) [0001803782-26-000003]"

    @server.tool()
    def secedgar_get_filing(accession_number: str, find: str = "") -> str:
        """Read a filing."""
        if accession_number == "huge":
            return "x" * (RESULT_MAX_CHARS + 500)
        if accession_number == "bad":
            raise ToolError("Expected dash format")
        return f"URL: {FILING_URL}\n\nTotal Amount Sold $1,585,000,000 USD"

    @server.tool()
    def secedgar_dataframe_drop(name: str) -> str:
        """Drop a dataframe (destructive)."""
        return "dropped"

    return server


async def test_only_the_edgar_tools_are_offered_with_the_servers_schemas():
    edgar = await Edgar.connect(fake_edgar())
    assert edgar.names == {"secedgar_search_filings", "secedgar_get_filing"}
    assert edgar.names <= set(TOOLS)
    search = next(t for t in edgar.tools if t["name"] == "secedgar_search_filings")
    assert search["description"] == "Search filings."
    assert search["input_schema"]["required"] == ["query"]


async def test_a_call_returns_the_text_and_counts():
    edgar = await Edgar.connect(fake_edgar())
    text, is_error = await edgar.call("secedgar_get_filing", {"accession_number": "0001803782-26-000003"})
    assert not is_error
    assert "Total Amount Sold $1,585,000,000 USD" in text
    assert edgar.calls == 1


async def test_a_tool_error_comes_back_as_an_error_result():
    edgar = await Edgar.connect(fake_edgar())
    text, is_error = await edgar.call("secedgar_get_filing", {"accession_number": "bad"})
    assert is_error
    assert "Expected dash format" in text


async def test_a_long_result_is_cut():
    edgar = await Edgar.connect(fake_edgar())
    text, _ = await edgar.call("secedgar_get_filing", {"accession_number": "huge"})
    assert text.startswith("x" * RESULT_MAX_CHARS)
    assert text.endswith(f"[cut at {RESULT_MAX_CHARS} characters]")


async def test_calls_past_the_limit_are_refused_without_reaching_the_server():
    edgar = await Edgar.connect(fake_edgar())
    for _ in range(CALLS_PER_PASS):
        assert not (await edgar.call("secedgar_search_filings", {"query": "Ramp"}))[1]
    text, is_error = await edgar.call("secedgar_search_filings", {"query": "Ramp"})
    assert is_error and "No more EDGAR calls" in text
    assert edgar.calls == CALLS_PER_PASS


async def test_a_server_that_cannot_be_reached_fails_to_connect_and_fails_calls_softly():
    with pytest.raises(Exception):  # noqa: B017 (whatever the transport raises)
        await Edgar.connect("http://127.0.0.1:9/mcp")
    edgar = Edgar("http://127.0.0.1:9/mcp", [])
    text, is_error = await edgar.call("secedgar_search_filings", {"query": "Ramp"})
    assert is_error and text.startswith("The EDGAR server failed")


def test_sec_urls_are_found_once_each_without_trailing_punctuation():
    text = f"URL: {FILING_URL}.\nAgain ({FILING_URL}) and https://example.com/x and https://sec.gov/a"
    assert sec_urls(text) == [FILING_URL, "https://sec.gov/a"]
