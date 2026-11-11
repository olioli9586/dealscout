"""Does the funding researcher do better with SEC EDGAR (the MCP server in
app/edgar.py)? Runs only the funding researcher and the verifier (much
cheaper than whole runs) on each company, with EDGAR and without, and
counts claims, supported claims, claims citing sec.gov, EDGAR calls, cost
and time. funding_status isn't a graded field (eval/ground-truth.json
grades website, founding year and HQ), so the values are printed for a
person to read.

Usage, from the repo root:
  PYTHONPATH=agent uv run --project agent --env-file .env.local \\
    python eval/edgar.py [--only "Ramp,Revolut"] [--label edgar-funding]

Writes eval/results/<label>.json.
"""

import argparse
import asyncio
import json
import time
from pathlib import Path

from anthropic import AsyncAnthropic
from app.anthropic_models import AnthropicModels, ModelConfig
from app.edgar import server_from_env
from app.state import spent

HERE = Path(__file__).parent
# Private US companies (a Form D is likely), public US companies, and
# companies outside the US (EDGAR is unlikely to help).
COMPANIES = [
    "Ramp",
    "Rippling",
    "Anduril",
    "Databricks",
    "Retool",
    "Vanta",
    "Cloudflare",
    "Duolingo",
    "Revolut",
    "Mistral AI",
]


async def one(models: AnthropicModels, company: str, setup: str) -> dict:
    started = time.monotonic()
    task = {"company": company, "branch": "funding", "hints": [], "attempt": 1, "retry_claims": []}
    finding, usage = await models.research(task)
    verdict, verify_usage = await models.verify(finding)
    supported = verdict["supported"]
    return {
        "company": company,
        "setup": setup,
        "claims": len(finding["claims"]),
        "supported": len(supported),
        "sec_claims": sum("sec.gov" in c["source_url"] for c in finding["claims"]),
        "sec_supported": sum("sec.gov" in c["source_url"] for c in supported),
        "mcp_tool_calls": usage[0]["mcp_tool_calls"],
        "searches": usage[0]["web_search_requests"],
        "cost_usd": spent(usage + verify_usage),
        "seconds": round(time.monotonic() - started, 1),
        "tool_errors": finding["tool_errors"],
        "funding_status": [c["value"] for c in supported if c["field"] == "funding_status"],
        "rejected": [
            {"value": c["value"], "source_url": c["source_url"], "reason": c["reason"]}
            for c in verdict["unsupported"]
        ],
    }


async def main(companies: list[str], label: str) -> None:
    config = ModelConfig.from_env()
    setups = {
        "edgar": AnthropicModels(AsyncAnthropic(), config, edgar_server=server_from_env()),
        "web only": AnthropicModels(AsyncAnthropic(), config),
    }
    jobs = [one(models, c, name) for c in companies for name, models in setups.items()]
    rows = []
    # Five at a time: each job is one researcher pass and one verifier call.
    for i in range(0, len(jobs), 5):
        rows += await asyncio.gather(*jobs[i : i + 5])
    for row in rows:
        print(
            f"{row['company']:11} {row['setup']:8} claims {row['supported']}/{row['claims']} "
            f"sec.gov {row['sec_supported']}/{row['sec_claims']} edgar calls {row['mcp_tool_calls']} "
            f"${row['cost_usd']:.3f} {row['seconds']}s  {'; '.join(row['funding_status'])[:120]}"
        )
        for error in row["tool_errors"]:
            print(f"{'':21}error: {error[:160]}")
    for name in setups:
        mine = [r for r in rows if r["setup"] == name]
        cost = sum(r["cost_usd"] for r in mine)
        supported, claims = sum(r["supported"] for r in mine), sum(r["claims"] for r in mine)
        sec = sum(r["sec_supported"] for r in mine)
        print(f"{name:8}: claims supported {supported}/{claims}, citing sec.gov {sec}, ${cost:.3f}")
    total = sum(r["cost_usd"] for r in rows)
    print(f"${total:.3f} in all")
    path = HERE / "results" / f"{label}.json"
    path.write_text(json.dumps({"label": label, "cost_usd": total, "rows": rows}, indent=2) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="comma-separated company names")
    parser.add_argument("--label", default="edgar-funding")
    args = parser.parse_args()
    names = args.only.split(",") if args.only else COMPANIES
    asyncio.run(main(names, args.label))
