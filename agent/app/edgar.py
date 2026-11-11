"""SEC EDGAR filings for the funding researcher, through an external MCP
server: the client half of "MCP both ways" (/api/mcp in the Next.js app is
the server half).

The server is cyanheads/secedgar-mcp-server (Apache 2.0). Its public
instance needs no key and sends SEC its own User-Agent, so nothing about
whoever runs DealScout goes to sec.gov. The tool list is read from the
server at the start of each pass, and three of its tools are offered to the
model: find a company, search filings (a private company's Form D shows
what it raised; a public company files S-1, 10-K and 8-K), and read one.

A result is treated like a web page: a claim may cite only a sec.gov URL
that a result named (it joins Finding.sources), and the text is data, not
instructions. A server that can't be reached costs the pass its EDGAR
tools, not the pass itself.

The server is stateless, so each call opens its own short connection
(about 0.4 s): a failure, including one while closing, stays inside that
call instead of failing the pass.
"""

import os
import re

from mcp import Client

from app import tracing

DEFAULT_URL = "https://secedgar.caseyjhand.com/mcp"
TOOLS = ("secedgar_company_search", "secedgar_search_filings", "secedgar_get_filing")
# Per researcher pass. A Form D's amounts section is about 3,000 characters
# when read with `find`; a whole 10-K page is 50,000, cut to the limit here.
CALLS_PER_PASS = 4
RESULT_MAX_CHARS = 12_000
TIMEOUT_SECONDS = 20
SEC_URL = re.compile(r"https://(?:www\.)?sec\.gov/[^\s<>\"'`)\]]+")

GUIDE = (
    "You also have SEC EDGAR tools (secedgar_*) from an external server, at most {calls} calls. A private "
    "US company files a Form D when it raises money: find it with secedgar_search_filings (the company's "
    'name, forms ["D"]), then read it with secedgar_get_filing (find: "Offering and Sales Amounts"). A '
    "public company files S-1, 10-K and 8-K. Cite the sec.gov URL that secedgar_get_filing returns, and "
    "make one claim per fact, each quoting the filing's own line: the amount sold (the \"Total Amount "
    'Sold" line) in one, the date (the "Filed:" line) in another. Filings by funds or SPVs named after the '
    "company are not the company's own raise."
)


def server_from_env() -> str | None:
    """EDGAR_MCP_URL, or the public instance when unset; empty turns EDGAR off."""
    url = os.environ.get("EDGAR_MCP_URL", DEFAULT_URL).strip()
    return url or None


class Edgar:
    """The EDGAR tools for one researcher pass."""

    def __init__(self, server: object, tools: list[dict]):
        # A URL, or an in-process server in the tests.
        self.server = server
        self.tools = tools
        self.names = {t["name"] for t in tools}
        self.calls = 0

    @classmethod
    async def connect(cls, server: object) -> "Edgar":
        """Lists the server's tools and keeps the EDGAR ones. Raises if the
        server can't be reached or lists none of them."""
        async with Client(server, read_timeout_seconds=TIMEOUT_SECONDS) as client:
            listed = (await client.list_tools()).tools
        tools = [
            {"name": t.name, "description": t.description or t.name, "input_schema": t.input_schema}
            for t in listed
            if t.name in TOOLS
        ]
        if not tools:
            raise RuntimeError("the server lists none of the EDGAR tools")
        return cls(server, tools)

    async def call(self, name: str, arguments: dict) -> tuple[str, bool]:
        """The result's text, cut to RESULT_MAX_CHARS, and whether it is an error."""
        with tracing.observation(name, as_type="tool", input=arguments) as span:
            text, is_error = await self._call(name, arguments)
            span.update(output=text, level="ERROR" if is_error else "DEFAULT")
        return text, is_error

    async def _call(self, name: str, arguments: dict) -> tuple[str, bool]:
        if self.calls >= CALLS_PER_PASS:
            return f"No more EDGAR calls in this pass (at most {CALLS_PER_PASS}). Report what you have.", True
        self.calls += 1
        try:
            async with Client(self.server, read_timeout_seconds=TIMEOUT_SECONDS) as client:
                result = await client.call_tool(name, arguments)
        except Exception as err:  # noqa: BLE001 (network, timeout or protocol: the model goes on without it)
            return f"The EDGAR server failed ({type(err).__name__}). Go on without it.", True
        text = "\n".join(c.text for c in result.content if c.type == "text")
        if len(text) > RESULT_MAX_CHARS:
            text = text[:RESULT_MAX_CHARS] + f"\n[cut at {RESULT_MAX_CHARS} characters]"
        return text, bool(result.is_error)


def sec_urls(text: str) -> list[str]:
    """The sec.gov URLs a result names, in order, without repeats."""
    return list(dict.fromkeys(u.rstrip(".,;:") for u in SEC_URL.findall(text)))
