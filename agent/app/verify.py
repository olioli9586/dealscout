"""The verifier's mechanical check, shared by the fakes and the real models.

A claim passes only if its source URL is one the researcher's web tools
actually returned in this run (Finding.sources comes from the API's result
blocks, not from the model), so a claim can't cite a page the run never saw.
The real verifier then asks a model whether each passing claim's quote
supports its value (app/anthropic_models.py).
"""

from urllib.parse import urlsplit

from app.state import Finding, Verdict

NOT_SEEN = "it cites a URL that none of the searches or fetches returned"


def normalize_url(url: str) -> str:
    """Scheme, "www.", the fragment and a trailing slash don't make a different page."""
    parts = urlsplit(url.strip())
    host = parts.netloc.lower().removeprefix("www.")
    path = parts.path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{host}{path}{query}"


def check_sources(finding: Finding) -> Verdict:
    seen = {normalize_url(u) for u in finding["sources"]}
    verdict: Verdict = {
        "branch": finding["branch"],
        "attempt": finding["attempt"],
        "supported": [],
        "unsupported": [],
    }
    for claim in finding["claims"]:
        if normalize_url(claim["source_url"]) in seen:
            verdict["supported"].append(claim)
        else:
            verdict["unsupported"].append({**claim, "check": "source", "reason": NOT_SEEN})
    return verdict
