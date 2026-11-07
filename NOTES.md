# DealScout v2 notes

Study notes for PROJECTS.md item 5 (DealScout v2: a stateful multi-agent
workflow). One section per working day: what was done, what was decided and
why, and the next step. Branch: `dealscout-v2`.

## Day 1 (2026-11-06): v1 baseline and the v2 proposal

### Done

- **v1 reports what it spends.** `runResearchAgent` adds up the usage of
  every API response and sends a `usage` event as the last event of every
  run, failed runs included: model, effort, API requests, input / output /
  cache tokens, web searches, web fetches and the cost in USD
  (`lib/pricing.ts`, prices from the Anthropic pricing page, checked today).
  The UI, batch mode and the MCP route ignore event types they don't know, so
  nothing else changed. The v1 loop itself is untouched: it stays the
  baseline.
- **The eval records cost and work per company** (`eval/run-eval.mjs`):
  run time, cost, API requests, searches and fetches next to the three graded
  fields, raw rows in `eval/results/<label>.json`, and a hard spend cap
  (`--max-usd`, default $5). No company starts once the cap is reached, and a
  run that reports no cost stops the eval, since the cap can't be enforced
  without it. Tested against two fake servers first (one stops at the cap
  after 2 of 5, one stops after the first run with no usage).
- **Baseline:** v1 code on `claude-sonnet-4-6` at effort `medium`, the 5
  ground-truth companies, run locally (`next dev`), $5 cap:
  **15/15 fields, 0 failed runs, $1.20 total** ($0.19 to $0.30 per company,
  median $0.24), **82 to 376 s per run (median 212 s)**, 3 or 4 searches and
  0 to 3 fetches per run, 2 API requests per run (the research request and
  the closing sentence). Table in `eval/RESULTS.md`, raw rows in
  `eval/results/v1.json`.

### What the baseline shows

- **One run of five would fail on the live demo.** Datadog took 376 s.
  Locally nothing stops it, but the deployed route has `maxDuration = 300`,
  so the stream would be cut and no profile saved. Under the real limit the
  success rate is 4/5, not 5/5. That is the number v2 has to beat, and it is
  why the v2 researchers run in parallel.
- **Run time varies 4.6x for the same kind of work** (82 s to 376 s). Almost
  all of it is one long API request in which Anthropic's servers run the
  search loop, so v1 has nothing to parallelize and nothing to resume: if
  that request dies, the run starts over.
- **No prompt caching** (0 cache tokens on every run). The closing-sentence
  request re-sends the whole conversation, search results included, for one
  sentence of output. That is a share of the 37k to 72k input tokens per run
  (not measured per request). v2 has no such turn, and caching cuts the
  rest; both go in the cost comparison.
- **Accuracy is saturated** at 15/15 on these fields, so on this set v2 can
  only tie. The comparison needs the 50-company set and the new metrics
  (citation support, success under the time limit, cost per run).

### Decisions and why

- **The baseline ran locally, not against the live demo.** The deployed
  demo doesn't send the usage event yet, so it can't report cost. The local
  run uses the same v1 code with the model and effort set explicitly
  (`claude-sonnet-4-6`, `medium`), which is what the July notes say the demo
  was switched to. Production's own values are hidden in Vercel; reading them
  would mean pulling the production API key onto disk, so that wasn't done.
  If the dashboard shows different values, the baseline is still a valid
  "v1 code on Sonnet 4.6 at medium effort" row, just not "the live demo".
- **Usage is the last event, sent from a `finally`.** That way a run that
  throws still reports what it cost before the error reaches the route.
  Responses that failed mid-stream report no usage, so they aren't counted;
  the cost is a lower bound for those runs.
- **The ground truth is 5 companies, not 15.** "15/15" in the README is
  fields (5 companies x 3 fields). Growing it to about 50 companies is a 10x
  step, and every new entry needs a hand check.

### The v2 proposal

**Decided 2026-11-06:** option A (Python LangGraph service), Langfuse for
tracing, and Haiku 5.5 + Sonnet 5.5 to start with, with a model sweep on
Day 3. The full proposal as agreed:

**Framework: two options.**

| | A. Python LangGraph service (recommended) | B. LangGraph.js in this Next.js app |
|---|---|---|
| Shape | `agent/`: FastAPI + `langgraph` + `langgraph-checkpoint-postgres` + the Anthropic Python SDK, pytest. Next.js stays the UI and keeps v1 | New `lib/v2/` with `@langchain/langgraph` and its Postgres checkpointer, vitest |
| Deploy | Two Vercel Services in this one project (Next.js + FastAPI), shipped together, the agent reached through a private binding. Fallback if Services doesn't fit their plan: a second Vercel project | Unchanged: one Next.js deployment |
| For | Python is what most AI job posts ask for; LangGraph's Python version is the reference one (features and docs land there first); "hand-rolled TS loop vs Python LangGraph" is a good interview contrast | One language, one test suite; reuses `lib/pricing.ts`, the rate limit and the `CompanyProfile` type |
| Against | Two languages and two test suites; the profile schema exists twice (Pydantic and TS) unless one JSON Schema feeds both; Vercel Services is new to this repo | No Python from this item, which is the gap the plan names |

In both, model calls go through the Anthropic SDK directly inside the graph
nodes, not LangChain's model wrappers: LangGraph handles orchestration and
state, and the SDK keeps the server-side web tools, `pause_turn`, citations
and exact usage numbers that v1 already relies on.

**The graph.**

```
load_memory -> planner -> [batch only: approve the batch and its cost estimate]
  -> researchers in parallel (business and products, funding and financials,
     leadership, news and deal signals; the planner picks 2 to 4)
  -> verifier --weak branch, retry left--> that researcher again (1 extra pass max)
  -> writer -> [interrupt: approve or edit] -> save (new profile version + what changed)
```

- *Planner*: a cheap model with a strict schema picks the branches and gives
  each one search hints.
- *Researcher*: a small tool loop with the server-side `web_search` and
  `web_fetch` (as in v1), with citations on. It returns claims
  (field, value, source URL, quoted text) through a strict tool.
- *Verifier*: mechanical check first (each claim's URL must be one this run
  actually searched or fetched, taken from the API's result blocks, not the
  model's word), then a cheap model checks the quote supports the claim. A
  branch below the support bar goes back once with its failed claims.
- *Writer*: builds the v1 `CompanyProfile` (plus sources per field) only from
  verified claims, "unknown" otherwise. It never sees raw page text, which is
  also the first injection defense.
- *Budget in the state*: every node adds its usage (steps and USD); once the
  run budget is spent, conditional edges skip retries and go straight to the
  writer. The daily global cap lives in Postgres, as in EvalBoard.

**State and resume.** A Postgres checkpointer on a new Neon database for
DealScout (not EvalBoard's, never job_tracker's). One thread per run; every
node boundary is a checkpoint. A killed run resumes by invoking the same
thread again; LangGraph keeps the writes of parallel branches that already
finished (its "pending writes"), so finished researchers shouldn't re-run.
Day 2's kill test checks that rather than trusting the docs. Each request
(start, resume, approve) runs the graph until it finishes or reaches the
approval interrupt, and parallel researchers should keep that well inside
300 s. If a request is cut anyway, "Resume" continues from the last
checkpoint. Approving sends `Command(resume=...)` in a new request. A `runs`
table feeds the run history page.

**Memory.** Short-term memory is the graph state (the checkpoints).
Long-term memory is a `profiles` table, one row per version (company key,
profile JSON, sources, run id, date). `load_memory` loads the latest version
and the writer reports what changed since then. LangGraph's own
`PostgresStore` is the framework-native alternative; a plain table is easier
to query for the history page and shows the SQL.

**Tracing: Langfuse (recommended) or LangSmith.** Both have free tiers that
fit (third-party figures, to confirm on their pricing pages: Langfuse Hobby
about 50k units a month, LangSmith Developer 5k traces a month with 14-day
retention). Langfuse is open source, self-hostable and OpenTelemetry-based,
so it traces Anthropic SDK calls and LangGraph nodes without LangChain.
LangSmith is LangChain's own and the most native LangGraph tracing (two env
vars), but the direct SDK calls need its wrapper.

**Models.** The baseline is a previous-generation model (Sonnet 4.6). v2
starts with Haiku 5.5 for the planner and verifier and Sonnet 5.5 for the
researchers and writer, then a model sweep on the 5 companies on Day 3, as
for EvalBoard. For a fair table, v1 also runs on the v2 researcher model, so
"new model" and "new architecture" show up as separate rows. API notes for
Sonnet 5.5: forced `tool_choice` is rejected (v1 already uses `auto` +
`strict`), and the refusal fallback (`fallbacks: "default"`) should be on.

**MCP both ways.** `/api/mcp` gains v2 tools (start a run, read its draft,
approve it). The funding researcher calls an external MCP server; the
candidate is SEC EDGAR filings (free public data) for public companies,
picked on Day 6.

**Guardrails.** Test pages with injected instructions, hosted on this
deployment for made-up companies (no real company is misrepresented).
Measure how often the agent follows them, before and after the defenses:
the writer and verifier see claims, never raw page text; every source URL
must be one the run fetched; output validation on the profile.

**Cost, and the nightly eval.** At the baseline's $0.24 per company, a v1
pass over 50 companies is about $12; v2 with 2 to 4 researchers will likely
cost 2 to 4x that per company before caching. A nightly 50-company eval is
out of budget. The plan is a small subset (about 5 companies) on a schedule
with a hard cap, plus a manual trigger for the full set. How often (nightly,
which is about $30 to $90 a month, or weekly) is their call on Day 9.

**Day plan (9 days, inside the plan's 7 to 10).**

1. Baseline and this proposal (today).
2. Service skeleton, Neon database and migrations (`runs`, `profiles`),
   the graph with fake model nodes and the Postgres checkpointer, a
   kill-and-resume test on the fakes, CI job, preview deploy.
3. Real planner, parallel researchers (web tools, citations) and writer;
   usage, cost and the run budget in the state; first runs on the 5
   companies; model sweep.
4. Verifier loop, memory ("what changed"), prompt caching (measure the cost
   drop).
5. UI: v2 run page streaming, approve or edit at the interrupt, run history,
   kill and resume on the deployed preview.
6. Tracing and MCP both ways.
7. Injection test pages and defenses, before and after.
8. Ground truth to about 50 companies (their hand check), the agent metrics,
   v1 vs v2 runs.
9. Scheduled CI eval with a hard cap; README (graph diagram, tables, trace
   screenshot), RESULTS.md, fresh-context review, merge, production env.

### Next

- Day 2. First check that Vercel Services works on their plan; if it
  doesn't, use a second Vercel project for the agent.
- Open question for them: production's `DEALSCOUT_MODEL` and
  `DEALSCOUT_EFFORT` (Vercel dashboard, Settings, Environment Variables), to
  label the baseline "the live demo" or keep it as "v1 on Sonnet 4.6".

## Day 2 (2026-11-07): the agent service, its database, and resume

### Done

- **Vercel Services works here, answered first.** Services is in beta on
  all plans. `vercel.json` now declares two services in the one project: the
  Next.js app (`web`, still at the repo root) and the agent (`agent`,
  FastAPI in `agent/`). The first preview built both
  (`services/agent/fastapi`, 29.8 MB, and the Next.js functions), and
  `GET /api/v2/health` reached the agent through the private binding. The
  agent's own paths (`/health`, `/docs`, `/openapi.json`) answer 404 from
  outside: only the Next.js app has a public rewrite.
- **The graph, on fake models** (`agent/app/graph.py`): `load_memory ->
  planner -> researcher` x N in parallel (one `Send` per branch) `->
  verifier`, which sends a weak branch back for one more pass (support
  below 0.8, at most 2 passes) `-> writer -> approve` (an `interrupt`)
  `-> save`, or the end on reject. The state is in `app/state.py`; parallel
  findings go through an appending reducer. Model calls sit behind one
  interface (`app/models.py`) with deterministic fakes (`app/fakes.py`);
  Day 3 swaps in the Anthropic version without touching the graph.
- **Postgres**: `agent/migrations/001_init.sql` (`runs`, `profiles`) and
  `app/migrate.py`, EvalBoard's scheme ported to Python (checksums,
  advisory lock, one transaction per file), followed by the LangGraph
  checkpointer's own `setup()`. The Vercel build of the agent runs it
  (`[tool.vercel.scripts]` in `pyproject.toml`).
- **Run lifecycle** (`app/runs.py`): a request drives the graph until it
  ends or pauses at the approval step, then records the status. Resume is
  allowed for a failed run, or a `running` one whose lease has run out;
  a decision only when the run is waiting for one. API in `app/main.py`:
  `POST /runs`, `GET /runs/{id}`, `POST /runs/{id}/resume`,
  `POST /runs/{id}/decision`, `GET /health`.
- **Next.js routes** `/api/v2/runs`, `/api/v2/runs/[id]`, `.../resume`,
  `.../decision`, `/api/v2/health` (`lib/agent-service.ts`): input checked
  and the per-IP quota charged before anything reaches the agent, run ids
  must be UUIDs, agent errors come back as `{error}`.
- **Neon**: a new free database, `dealscout-db` (iad1), created with
  `vercel integration add neon ... -e preview --no-env-pull`: connected to
  Preview only, and its credentials never came to this laptop.
- **Preview, end to end on fakes**: the build log shows
  `migrate: applied 001_init.sql`; start a run, approve it, profile
  version 1 saved, resume answers 409 on the finished run. A whole fake run
  takes 0.5 to 0.6 s seen from here, about 7 checkpoint writes to Neon
  included, so checkpointing costs nothing next to model calls.
- **Tests**: 34 pytest (local Postgres 14, Postgres 17 in the new CI
  `agent` job, plus ruff) and 85 vitest (18 new). Every commit passes on
  its own in a clean worktree.

### Kill and resume: what the tests show

Day 1 said "finished researchers shouldn't re-run, but check it rather
than trust the docs". Three tests:

1. A researcher crashes: the run is `failed`, resume runs only that
   researcher again.
2. A run is cancelled mid-step, the way a request is cut at the time
   limit: nothing marks it failed, so it stays `running`; resume is refused
   until its lease runs out, then the three researchers that had finished
   are not run again.
3. A separate process running the graph is SIGKILLed mid-step, and this
   process resumes it. A call log written by both processes shows business,
   funding and news ran once (in the killed process) and leadership ran
   twice (killed once, finished on resume).

To check the tests can fail, four bugs were planted one at a time:
durability `"exit"` (2 tests fail), deleting the step's pending writes
before resuming (2), no lease check (2), resume restarting from scratch
(3). The pending-writes one is the evidence: skipping finished
researchers comes from LangGraph's pending writes.

### Decisions and why

- **The Next.js app stays at the repo root.** Vercel's guides put every
  service in its own folder (`frontend/`, `backend/`), but `"root": "."`
  works (the preview proved it), and moving the app would touch every v1
  file and its history.
- **The agent is private; the Next.js routes forward to it.** One public
  surface: the v1 rate limit and any later auth live in one place, no CORS.
  A binding grants reachability, not authentication, so the agent trusts
  every caller; that's safe only because it has no public route.
- **Durability `"sync"`.** The default `"async"` writes a step's checkpoint
  while the next step runs, so a kill can lose a step; `"exit"` writes
  nothing until the run ends (the kill tests fail with it). `"sync"` costs a
  database round trip per step, which is nothing next to model calls.
- **A lease, not just a status.** A request cut off at 300 s can't mark its
  run, so a run holds a lease of 330 s (past `maxDuration`). Resume needs
  the lease to have run out, which also stops two requests driving one
  thread and paying twice.
- **Save is idempotent per run** (`profiles.run_id` is unique): a save that
  runs again after a resume can't store a second version. The approve node
  does nothing before `interrupt()`, because it runs again from the top on
  resume.
- **Pooled URL at runtime with prepared statements off; unpooled for
  migrations** (advisory locks need their own session). Same split as
  EvalBoard.
- **Migrations run in the Vercel build.** No database credentials on a
  laptop. The cost: a migration must stay compatible with the deployment
  still serving until the new one is live.
- **Preview database only.** Production gets a database of its own at
  merge (Day 9), so preview test runs never show up in the live history.
- **Python 3.13 and uv** (Vercel runs 3.12 to 3.14 and read
  `agent/.python-version`; 3.13 has wheels for every dependency). Dev tools
  are an optional extra, so the deployed function doesn't install pytest.
  `uv` was installed with Homebrew for this.
- **Fakes on the preview.** `AGENT_MODELS` defaults to `fake` until Day 3.
  `FAKE_RESEARCH_SECONDS` slows the fake researchers, for the kill test on
  the deployed preview on Day 5.
- **Deferred:** the batch approval interrupt moves to Day 5, with the
  batch UI.

### Known gaps

- An edited profile can be any JSON object; validate it against the
  profile schema once the real writer exists (Day 3).
- Anyone with a run id can approve it. Ids are random UUIDs, like
  EvalBoard's share links; fine for the demo.
- Preview has no `ANTHROPIC_API_KEY` (only Production has one). Day 3
  needs one on Preview: their call whether to use a separate key with its
  own spend limit in the Anthropic Console.
- `runs` has no cost or budget columns yet (Day 3).

### Run it locally

```bash
cd agent
uv sync --extra dev
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/dealscout_test uv run pytest -q
DATABASE_URL=postgresql://... uv run python -m app.migrate
DATABASE_URL=postgresql://... uv run uvicorn app.main:app --port 8001
# then, in the repo root:
AGENT_URL=http://127.0.0.1:8001 npm run dev
```

The test database's name must contain "test": the test session drops its
schema first.

### Next

- Day 3: the real planner, researchers (web search and fetch, citations)
  and writer; usage, cost and the run budget in the state; first runs on
  the 5 companies; model sweep. Needs an Anthropic key on Preview (above),
  and their OK on the spend cap for the runs.
