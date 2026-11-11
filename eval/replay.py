"""Replays the verifier and writer on a saved v2 eval run's own findings,
with the current code, and grades the new drafts like run-eval.mjs. The
research is the same, so a change in the score comes from the verifier and
writer alone, at a fraction of a full run's cost (no web searches).
Retries aren't replayed: each branch keeps the passes the run made.

Usage, from the repo root:
  DATABASE_URL=postgresql://... PYTHONPATH=agent uv run --project agent \\
    --env-file .env.local python eval/replay.py v2-48

Writes eval/results/replays/<label>.json (kept out of RESULTS.md: these
aren't whole runs).
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from anthropic import AsyncAnthropic
from app.anthropic_models import AnthropicModels, ModelConfig
from app.db import make_pool
from app.state import spent
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

HERE = Path(__file__).parent
TRUTH = {c["name"]: c for c in json.loads((HERE / "ground-truth.json").read_text())["companies"]}
FIELDS = {"website_domain": "website", "founded_year": "founded_year", "hq_city": "hq_location"}


def grade(name: str, profile: dict) -> dict[str, bool]:
    """The same rule as run-eval.mjs: the answer contains an accepted value."""
    answer = {f: str(profile.get(key, "")).lower() for f, key in FIELDS.items()}
    return {f: any(a in answer[f] for a in TRUTH[name][f]) for f in FIELDS}


async def replay(models: AnthropicModels, saver: AsyncPostgresSaver, row: dict) -> dict:
    saved = await saver.aget_tuple({"configurable": {"thread_id": row["run_id"]}})
    values = saved.checkpoint["channel_values"]
    results = await asyncio.gather(*(models.verify(f) for f in values["findings"]))
    verdicts = [v for v, _ in results]
    draft, write_usage = await models.write(values["company"], verdicts, None)
    usage = [u for _, us in results for u in us] + write_usage
    return {
        "name": row["name"],
        "run_id": row["run_id"],
        "before": row["fields"],
        "after": grade(row["name"], draft),
        "supported": sum(len(v["supported"]) for v in verdicts),
        "claims": sum(len(v["supported"]) + len(v["unsupported"]) for v in verdicts),
        "cost_usd": spent(usage),
        "profile": {key: draft[key] for key in FIELDS.values()},
    }


async def main(label: str) -> None:
    saved = json.loads((HERE / "results" / f"{label}.json").read_text())
    rows = [r for r in saved["rows"] if r.get("run_id")]
    models = AnthropicModels(AsyncAnthropic(), ModelConfig.from_env())
    pool = make_pool(os.environ["DATABASE_URL"])
    await pool.open()
    try:
        saver = AsyncPostgresSaver(pool)
        out = []
        # Eight at a time: each replay is one verifier call per finding plus the writer.
        for i in range(0, len(rows), 8):
            out += await asyncio.gather(*(replay(models, saver, r) for r in rows[i : i + 8]))
    finally:
        await pool.close()
    before = sum(sum(r["before"].values()) for r in out if r["before"])
    after = sum(sum(r["after"].values()) for r in out)
    for r in out:
        for f in FIELDS:
            if r["before"].get(f) != r["after"][f]:
                answer = r["profile"][FIELDS[f]]
                print(f"{r['name']:12} {f:15} {r['before'].get(f)} -> {r['after'][f]}  ({answer})")
    cost = sum(r["cost_usd"] for r in out)
    supported, claims = sum(r["supported"] for r in out), sum(r["claims"] for r in out)
    print(f"fields correct: {before} -> {after} of {3 * len(out)}; claims supported {supported}/{claims}")
    print(f"${cost:.3f}")
    path = HERE / "results" / "replays" / f"{label}.json"
    path.parent.mkdir(exist_ok=True)
    summary = {"label": label, "fields_before": before, "fields_after": after, "cost_usd": cost, "rows": out}
    path.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
