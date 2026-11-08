"""The verifier's mechanical check, shared by the fakes and the real models.

A claim is supported only if its source URL is one the researcher's web
tools actually returned in this run (Finding.sources comes from the API's
result blocks, not from the model), so a claim can't cite a page the run
never saw. Checking that the quote supports the claim is a model call,
added on Day 4.
"""

from urllib.parse import urlsplit

from app.state import Finding, Verdict


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
        key = "supported" if normalize_url(claim["source_url"]) in seen else "unsupported"
        verdict[key].append(claim)
    return verdict
