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

## Day 3 (2026-11-08): real models, cost and budget, first runs, the sweep

### Done

- **The real model calls** (`agent/app/anthropic_models.py`), through the
  Anthropic SDK directly:
  - *Planner*: Haiku 5.5 at low effort, structured output (`messages.parse`
    with a Pydantic schema). It picks the areas and 1 to 3 search queries
    each. With no previous profile it covers every area; skipping areas
    only matters once memory exists (Day 4).
  - *Researcher*: a short loop with the server-side `web_search` and
    `web_fetch` tools (`_20260209`, as in v1) and a strict `report_findings`
    tool for the claims (field, value, URL, quote). The loop follows
    `pause_turn`, reuses the code execution container, and asks once more
    if the model stops without reporting. The URLs the tools returned are
    read from the response's result blocks, not taken from the model.
  - *Writer*: structured output with the profile schema. It sees each
    verified claim's field, value and URL, and never the quotes or any page
    text.
- **The verifier's mechanical check** (`app/verify.py`): a claim counts as
  supported only if its URL is one the run's tools actually returned.
  Today it is the whole verifier; the model check that the quote supports
  the claim comes on Day 4.
- **One profile schema** (`app/profile_schema.py`): v1's `CompanyProfile`
  plus `leadership`, and per field the URLs of the claims behind it,
  added by code. The same Pydantic model is the writer's output schema,
  what the fakes return, and the check on an edited profile: a broken edit
  now gets a 422 (a Day 2 known gap, closed). `to_saved` resets any field
  that no supported claim backs to "unknown", so the writer can't add
  facts nobody verified.
- **Usage and cost in the state.** Every node returns its usage together
  with its result (`Usage` in `app/state.py`), so both land in the same
  checkpoint. `app/pricing.py` is `lib/pricing.ts` ported, with the same
  test cases, so v1 and v2 are priced alike. The run view shows totals and
  every node's entry (model, effort, requests, searches, fetches, cost,
  seconds).
- **Run budget** (`AGENT_RUN_BUDGET_USD`, default $1.50), enforced in the
  graph: before the fan-out, and before each retry, using what that
  branch's last pass cost as the estimate for the next one. The writer
  always runs, so a run over budget still ends with a draft.
- **Daily cap** over all runs (`AGENT_DAILY_USD`; with real models and no
  value set it is $5, so the default fails closed): checked before a start
  or a resume, answered with a 429. Migration `002_cost.sql` adds
  `budget_usd` and `cost_usd` to `runs`.
- **Eval**: `run-eval.mjs --api v2` runs each company through
  `/api/v2/runs` and grades the draft. It records the claims and each
  node's model and effort, and never approves, so no run gets memory from
  another. `eval/report.mjs` renders `RESULTS.md` from every saved result,
  so v1 and each v2 setup sit in one table.
- **A Day 2 test bug, fixed.** The cut-off tests waited for "3 findings
  written", but the run's input (`{"findings": []}`) is stored as a
  `findings` write too, so they sometimes cut the run after only 2
  researchers. LangGraph then rightly ran the third again, and the test
  failed about 1 time in 5. Now they count only writes made by graph steps,
  and one researcher finishes 0.3 s after the others, so the old helper
  fails every time (checked: 3 out of 3). Day 2's conclusion stands:
  finished researchers aren't run again.
- **Tests**: 64 pytest (30 new; the Anthropic code runs against a scripted
  client, so no network or key) and the 85 vitest, unchanged. ruff clean.
  Every commit passes on its own in a clean worktree.

### Results (5 companies, local agent and Next.js, `eval/RESULTS.md`)

| setup | fields correct | median time | median cost | claims supported |
|---|---|---|---|---|
| v1, Sonnet 4.6 (Day 1) | 15/15 | 212 s | $0.242 | n/a |
| v2, all Haiku 5.5 | 14/15 (sweep 1: 15/15) | 27 s | $0.127 | 241/242 |
| v2, Haiku researchers, Sonnet 5.5 writer | 13/15 (15/15) | 39 s | $0.162 | 239/241 |
| v2, Sonnet 5.5 researchers and writer | 9/15 (12/15) | 48 s | $0.531 | 64/64 |

The planner is Haiku at low effort in every v2 setup. Sweep 1's raw rows
are in `eval/results/sweep1/`. Between the sweeps the researcher was
told how to find two fields: fetch the homepage for `website`, and
`hq_location` is the main office, not a registered or mailing address
(Sonnet had given Vercel's HQ as Covina, California, from PitchBook). The
writer also lost the ability to fill fields without a claim. Both sweeps
ran the same 5 companies.

### What the sweep shows

- **All-Haiku v2 matches v1 on the graded fields at about half the cost
  and 7x faster.** The time drop comes from running the researchers in
  parallel. The cost drop comes from the model's price.
- **On Haiku the bill is web search, not tokens.** Each run makes 8 to 11
  searches at $0.01, which is about $0.10 of the $0.12. Fewer searches per
  researcher is the next cost lever, not a cheaper model.
- **Sonnet 5.5 researchers cost about 4x as much and did worse.** They
  report far fewer claims (64 to 73 across the 5 companies, against about
  240 for Haiku). Their business pass reports about 4 claims and no
  website, even after the "fetch the homepage" hint. The runs did fetch
  pages (10 fetches in sweep 2), just not the homepage in that pass. The
  cause isn't known yet. One idea to test cheaply on Day 4: with
  `_20260209` the tools run from code (dynamic filtering) by default, so
  let `web_fetch` be called directly and compare.
- **A Sonnet writer bought nothing measurable** on the graded fields, for
  about $0.04 more per company. Ungraded fields (summary quality, news)
  aren't measured, so this says nothing about them.
- **"Claims supported" near 100% means the URL check alone is weak**:
  models cite pages their searches returned. The quote check on Day 4 is
  what will make this number informative.
- **5 companies x 3 fields is too small to rank close setups.** Airbnb's
  website flipped between sweeps on the same Haiku setup: reported in one,
  not in the other. 14/15 against 13/15 is noise. The sweep 2 prompt
  changes were also made after looking at these 5 companies' misses, so
  they're tuned on the test set. The 50-company set on Day 8 is the real
  test.

### Decisions and why

- **Default to Haiku 5.5 everywhere** (Day 1 planned Haiku plus Sonnet;
  the sweep decides). Env vars switch any node's model:
  `AGENT_PLANNER_MODEL`, `AGENT_RESEARCHER_MODEL`, `AGENT_WRITER_MODEL`,
  `AGENT_EFFORT`.
- **A strict tool for the researcher's claims, structured output for the
  planner and writer.** JSON structured output is documented as
  incompatible with citations, which web search always turns on. v1
  already used a strict tool alongside the web tools.
- **Usage is returned with the result**, not counted on the side, so a
  node that finished is counted exactly once even after a resume. A node
  cut off mid-call reports nothing: run costs are a lower bound for runs
  that were cut off, as in v1.
- **Spend limits fail closed.** A cost the table can't price makes the
  spent amount infinite (no more research, the daily cap refuses). A model
  with no price, or a limit set to `nan`, `inf` or a negative number, stops
  the agent at startup: NaN would make every `spent >= limit` check false
  (the lesson v1's rate limit already learned).
- **The budget is checked at the graph's edges, not inside a
  researcher.** Parallel researchers can't see each other's spend, so one
  research step can overshoot. Each pass is bounded by 6 requests of at
  most 8,000 output tokens, 3 searches and 2 fetches per request, and
  8,000 tokens per fetched page.
- **The daily cap counts what finished requests recorded.** A request in
  flight isn't counted yet, and two starts at the same moment can both
  pass, so it bounds spend to the cap plus the runs in flight. That's fine
  for a demo; an atomic reservation would fix it.
- **No "page text is data, not instructions" line in the prompts yet**, so
  the Day 7 injection test has a clean before. The writer seeing claims
  and never page text is already in place (it's the design, not a
  defense added later).
- **Leadership is a profile field now.** v1 had nowhere to put the
  leadership researcher's output.
- **Refusal fallbacks are not on yet.** A refusal ends that researcher with
  no claims (and the verifier then counts it as weak). Haiku 5.5 has no
  server-side fallback anyway.
- **All runs were local**, with the key already in `.env.local`. Preview
  still has no key and runs the fakes, so no Vercel setting changed.

### Known gaps

- Preview still runs the fakes. Real models on the deployed preview need an
  `ANTHROPIC_API_KEY` there (their call: a separate key with its own spend
  limit) and `AGENT_MODELS=anthropic`.
- The smoke run's business researcher once reported 0 claims. The retry
  recovered, but the retry prompt has nothing specific to say when there
  were no failed claims.
- The eval leaves its runs waiting for approval; nothing cleans them up.

### Closed: production's model and effort (Day 1's open question)

Production's `DEALSCOUT_MODEL` and `DEALSCOUT_EFFORT` are Secret variables,
which Vercel makes write-only: nobody can read them, in the dashboard or
with `vercel env pull`. Both were created on 2026-07-07, the day of the
commit "Fit Sonnet runs inside the 300s function limit", which fits the
Sonnet-at-medium switch the July notes describe but doesn't prove the
exact model. So the baseline stays labeled by what was measured (v1 on
Sonnet 4.6 at medium effort). At the merge (Day 9), set both again as
Config variables (they aren't secrets), so production's model can be read
from then on.

### Spend

$8.09 of the $10 cap set for today, all local: smoke run $0.09, sweep 1
$3.88, sweep 2 $4.12 (the local `runs` table sums the same).

### Run it locally (real models)

```bash
cd agent
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/dealscout_dev uv run python -m app.migrate
AGENT_MODELS=anthropic AGENT_DAILY_USD=10 \
  DATABASE_URL=postgresql://postgres@127.0.0.1:54329/dealscout_dev \
  uv run --env-file ../.env.local uvicorn app.main:app --port 8001
# then, in the repo root:
AGENT_URL=http://127.0.0.1:8001 DEMO_DAILY_LIMIT=1000 npm run dev -- --port 3100
node eval/run-eval.mjs http://localhost:3100 --api v2 --label v2-haiku --max-usd 1
```

### Next

- Day 4: the verifier's model check (does the quote support the claim?)
  and the retry loop on real runs; memory ("what changed" since the last
  saved profile); prompt caching, with the cost drop measured. Also two
  cheap experiments: fewer searches per researcher, and a direct
  `web_fetch` for Sonnet researchers. Each has a small cap; ask before
  anything bigger.

## Day 4 (2026-11-09): the quote check, memory, caching, and what the first runs broke

### Done

- **The verifier's model check** (`app/anthropic_models.py`): after the
  source check, Haiku 5.5 at low effort judges, in one call per finding,
  whether each claim's quote supports its value. It writes its reason
  before its verdict. A claim its answer leaves out, or a refused call,
  counts as unsupported. Each rejected claim records which check failed
  (`source` or `quote`) and why; the run view lists them, and a retry
  prompt passes the reasons on (or says the first pass found nothing).
- **Memory.** On a re-run, a field with no supported claim keeps the saved
  version's value and sources (`carried_over` lists them) instead of
  turning unknown: not finding a fact again isn't evidence it changed. The
  writer sees the saved facts (not their sources) and is told to keep
  their wording where claims confirm them. The planner sees them with the
  date they were saved and may skip areas. The run view's `changes`
  compares the saved version with the draft, or with the edit once there
  is one, ignoring case, spacing and list order. Profiles that predate a
  field (Day 2's fakes, or no `leadership`) read it as unknown.
- **Prompt caching on the researcher**: an explicit breakpoint after the
  tools and system prompt that every researcher sends, and the automatic
  one at the end of the conversation. Each usage entry now carries
  `uncached_cost_usd`, the same tokens priced with nothing cached, so the
  saving is exact for each run rather than a comparison of two noisy runs.
- **`AGENT_SEARCHES`**: the researcher's search limit per request (default
  3, unchanged), for the experiment below.
- **Eval**: each v2 row records the uncached cost, which check rejected
  each claim, how many branches were retried, and the run's memory.
  `--approve` saves each draft so the next eval of the same companies runs
  with memory. RESULTS.md gains the matching columns and a memory table.
- **Fixes from the first real runs** (next sections): values say only what
  their quote says, at most 10 claims per report, a report cut off at
  `max_tokens` is answered and asked for again, the writer uses every
  pass, the retry bar is 50%, the verifier reasons before deciding, the
  web tools take `strict` input, and findings record web tool errors with
  what the call asked for.
- **Tests**: 84 pytest (20 new) and the 85 vitest, unchanged. ruff clean.
  The new graph tests were checked against the old behavior (the last
  pass only, the 80% bar): each fails on it.

### What the probes showed (about $0.07, before any full run)

- **`web_fetch` only opens URLs that are already in the conversation**:
  the user's message or an earlier search or fetch result. Anything else
  fails with `url_not_in_prior_context`, and no setting allows any URL
  (`url_sources` only narrows the set). Day 3's "fetch the homepage" hint
  therefore failed whenever a search hadn't returned the homepage, which
  likely explains Day 3's missing websites, Sonnet's included. It's also
  an exfiltration guard to name on Day 7.
- **Search results come back encrypted**, and Haiku reports through the
  tool without writing cited text, so the only page text the code could
  check a quote against is a fetched page (1 to 3 a run, some failing).
  The quote check is therefore a model comparing quote and value. It
  catches values that claim more than their quote; it can't catch a quote
  the researcher made up.
- **Haiku calls the web tools directly** (no dynamic filtering) and does a
  whole pass in one request; caching still pays inside it, because the
  server's own search loop reads what the previous step wrote (7k, then
  14k tokens read within single requests).

### The runs (5 companies, local agent and Next.js, all Haiku 5.5)

| run | fields | median cost | median time | searches | retried branches | claims supported |
|---|---|---|---|---|---|---|
| Day 3, URL check only (`v2-haiku`) | 14/15 | $0.127 | 27 s | 47 | 0 | 241/242 |
| 1. quote check as first written | 11/12, 1 run crashed | $0.229 | 63 s | 89 | 15 | 98/211 |
| 2. + researcher prompt, cut-off fix | 13/15 | $0.217 | 59 s | 78 | 16 | 111/155 |
| 3. + every pass, 50% bar | 11/15 | $0.146 | 50 s | 58 | 6 | 137/207 |
| **4. + reason first, strict web tools (`v2-day4`)** | **14/15** | **$0.132** | **46 s** | 57 | 3 | 151/210 |
| memory re-run from run 3's profiles | 13/15 | $0.098 | 53 s | 45 | 6 | 95/153 |
| run 4 with one search per request | 12/15 | $0.069 | 49 s | 25 | 5 | 150/214 |

Runs 1 to 3 are in `eval/results/day4/`. Runs 1 and 2 count claims on
each branch's final pass (as Day 3 did); the rest count every pass. The
memory run used run 4's code without `strict` on the web tools.
Caching saved 5.3% in run 4 and the memory run, and 16.7% with one search.

### What the runs show

- **The URL check alone said nothing; the quote check does.** In run 4 the
  URL check rejected none of 210 claims and the quote check rejected 59
  (28%). Day 3's 241/242 measured only that models cite pages their
  searches returned.
- **The first runs broke in five ways, each now fixed and tested:**
  - Values claimed more than their quotes (dates, investors, career
    history). Vercel's news pass had 2 of 16 claims supported; with "the
    value says only what its quote says" in the prompt, 8 of 10.
  - A news retry listing 17 failed claims crashed the run: its report had
    no `claims`. Most likely it hit the 8,000-token output cap mid-report
    (strict only holds for a finished call); the raw response wasn't kept.
  - The writer used only each branch's last pass, so a retry replaced the
    first pass: Datadog lost a verified HQ and Airbnb its funding status.
  - The 80% retry bar sent 16 of 20 branches back, doubling searches and
    cost; 9 of the 16 already had 60% or more of their claims supported.
  - Haiku's verdicts at low effort contradicted its own reasons ("supported
    actually" on a rejected claim) and rejected a city because the quote
    also had the street. With the reason first, two replays of run 3's 207
    claims supported 146 and 143 (from 137), and the first fixed all four
    core-field misses, for $0.01 each. Medium effort supported 135 for 50%
    more; with no per-claim ground truth, low stays.
- **Passes that reported nothing had a cause**: Haiku sometimes sent
  `web_search {"params": {"query": ...}}`, rejected as `invalid_tool_input`;
  after three, the search limit was spent. Run 2 had 6 passes with no
  searches and no claims (it didn't record tool errors yet); run 3 had 3,
  all after `invalid_tool_input`, and so did 2 in the memory run. Run 4,
  with `strict` on the web tools, had none.
- **Run 4 against Day 3: same fields, same cost, slower.** 14/15 both;
  $0.132 against $0.127 median. The verifier's tokens are $0.01 over 5 runs.
  The extra time (46 s against 27 s) most likely comes from the verifier
  step, the retries and 10 more searches; it wasn't broken down.
- **Caching saves little on Haiku**: 5.3%, because searches are 82% of
  the bill and Haiku's tokens are cheap. With Sonnet researchers (input
  20x the price) it would matter far more; not measured today.
- **Memory works, and "what changed" is noisy.** Re-running from saved
  profiles, the planner skipped areas in 4 of 5 companies and the re-runs
  cost 21% less ($0.55 against $0.70; Vercel 56% less, Datadog 43%).
  Carried-over fields came through intact. But of 10 single-value
  changes, 4 were real fills (unknown to found), 1 a real move (market
  cap), and 5 were rewordings or a different fact picked ("AI safety and
  research" to "Artificial intelligence"). List fields changed on every
  run, because each run picks different news items. "Keep the saved
  wording" isn't enough on Haiku.
- **One search per request halves the cost and loses websites**: 12/15,
  missing two websites and Vercel's HQ. The business researcher can't find
  the homepage and the rest in one search. The default stays at 3.
- **Still small and tuned.** Re-verifying the same claims twice moved the
  count by 3. The prompt fixes were made after reading these 5 companies'
  failures. Day 8's 50 companies is the test.

### Decisions and why

- **A strict quote standard**: a value that adds anything its quote
  doesn't state is rejected, and the researcher is told so. Looser checks
  were what Day 3's 100% measured.
- **The writer uses every pass; retries only below 50% support.** A retry
  is for a branch that mostly failed, not for polishing a good one.
- **Carry-over is per field.** A list field found again is replaced whole,
  so a leadership list found with fewer names drops the rest (and shows
  as a change).
- **`changes` is computed by code**, deterministic and tested; the cost is
  the rewording noise above.
- **Caching only on the researcher.** The planner, verifier and writer send
  short prompts once per run or per branch, probably near or under the
  512-token minimum; not measured.
- **The Sonnet direct-fetch experiment wasn't run.** The fetch rule above
  explains the homepage misses for both models, and the budget went to
  fixing what the first runs broke.

### Known gaps

- Researchers still add street addresses to HQ values: 3 rejections today,
  including Airbnb's miss in run 4. "No street address" in the field hint
  is the likely fix; not made, because it couldn't be measured today.
- "What changed" is noisy (above). Options: count fills separately, report
  only added list items, or have the writer name the fields that changed
  in fact.
- A made-up quote that supports its value passes. For fetched pages, code
  could check the quote against the page text.
- The verifier reads the quotes, which are page text: an injection path
  for Day 7. The writer still sees no page text.
- A retry claim from a Day 3 checkpoint has no reason; resuming such a run
  into a retry would fail. Only old local runs have one.
- The eval leaves its runs waiting for approval (Day 3, still open).

### Preview

They added `ANTHROPIC_API_KEY` to Preview (Secret, all Preview branches).
`AGENT_MODELS` is still unset there, so Preview runs the fakes until Day 5.

### Spend

$4.66 of the $5 cap set for today: full runs $4.37 (runs 1 to 3 $1.08,
$0.98, $0.70; memory $0.55; run 4 $0.70; one search $0.36), probes and
replays $0.29. The agent's daily cap was set each time so its runs plus
the probes stayed under $5.

### Run it locally (real models)

As on Day 3. Add `--approve` to an eval to save its drafts (the next eval
of the same companies then runs with memory; `delete from profiles` in
the dev database for memory-free runs again), and `AGENT_SEARCHES=1` to
the agent for one search per request.

### Next

- Day 5: the UI (v2 run page; approve or edit, with `changes`,
  `carried_over` and the rejected claims and their reasons shown; run
  history), real models on the deployed preview (`AGENT_MODELS=anthropic`
  and a daily cap there: their OK), kill and resume on the preview.
- Small, each with a measured run: the HQ street-address hint, and
  per-area search limits (more for business, one for the others).

## Day 5 (2026-11-09): the UI, real models on the preview, kill and resume there

### Done

- **Agent API**: `POST /runs` takes an optional id chosen by the caller (a
  reused id is a 409), and `GET /runs?ids=` returns those runs' rows,
  newest first. There is no list of every run: the history lives in the
  browser, as in EvalBoard. The Next.js routes pass both on (UUIDs only,
  at most 100 ids).
- **`lib/v2-client.ts`**: the run view's types, API calls that keep the HTTP
  status, the history in localStorage, each branch's passes from the
  checkpointed state, and the edit form, which keeps a field's sources only
  if the edit left its value unchanged and drops `carried_over`.
- **`/v2`**: start a run (the browser picks the id and opens the run page at
  once, while its start request runs the graph) and "Your runs".
- **`/v2/runs/[id]`**: while a request drives the run, the page polls the
  checkpointed state every 1.5 s: the plan, each branch's passes
  (researching, verifying, how many claims verified), the rejected claims
  with which check failed and why, and web tool errors. Then the draft,
  with each field's sources, "kept from vN" on carried-over fields and
  what changed since the saved version; Approve, Edit or Reject; Resume
  for a cut-off or failed run; cost per step. Links are only made for
  http(s) sources (an edit can put any string there, and memory carries it
  into later runs). Run pages aren't indexed.
- **Preview runs real models**: `AGENT_MODELS=anthropic` and
  `AGENT_DAILY_USD=3` (their OK, Config type so they stay readable).
- **Tests**: 89 pytest (5 new) and 100 vitest (15 new). Every commit
  passes on its own.

### Checked in a browser (local, fake models)

Headless Chrome against the local agent on fakes: start, live progress,
the draft, an edit saved as version 1, the history row, a second run of
the same company showing "Researched before" and the edited HQ under
what changed, and a reject. Then a kill: the agent process was killed
mid-research and the page said "The agent is unreachable"; with the agent
back and the lease expired (set in the dev database instead of waiting
330 s), the page showed "Cut off" and Resume finished the run to a draft.

Not checked in a browser on the preview: Vercel Authentication needs a
fresh OIDC token in the browser, the one in `.env.local` expired in July,
and pulling a fresh one was blocked by auto mode. They can open the
preview in their own browser, logged in to Vercel.

### On the deployed preview (through its API, `vercel curl`)

- **A real run** of Ramp: 57 s, $0.138, the news branch retried once, 15 of
  44 claims rejected, approved as version 1.
- **A second Ramp run whose client hung up after 15 s** went on and reached
  approval at 58 s ($0.111). It started from version 1, researched
  funding, news and leadership, and carried over the 7 business fields.
- **What cuts a request on Vercel, and what doesn't.** A client hanging up
  doesn't. Deleting the deployment mid-run doesn't either: a run on a
  deleted deployment finished, and its client even got the answer. The
  300 s limit does. A fake run with 320 s researchers was cut at 301 s
  (HTTP 504), stayed "running" with no findings, became resumable when
  its 330 s lease ran out, and Resume on another deployment finished it
  in 42 s. That is the case the design is for. From outside, a step's
  findings only show once the whole step has finished, so Day 2's local
  SIGKILL tests remain the evidence that finished researchers aren't run
  again.
- How: throwaway redeploys of the PR's preview, built while Preview briefly
  had `AGENT_MODELS=fake` and `FAKE_RESEARCH_SECONDS` (40, then 320). The
  settings were put back after each build and the throwaways deleted; the
  PR's own preview was never rebuilt.

### Blocked: the Anthropic API usage limit

The fourth real run on the preview failed at the planner: "You have
reached your specified API usage limits. You will regain access on
2026-12-01 at 00:00 UTC." That is the spend limit set in the Anthropic
Console, reached this month; every call with this key fails until then,
and likely anything else on the same account. Days 6 to 8 need real runs
(real traces, the injection tests, the 50-company eval): their call
whether to raise the limit or work on what the fakes allow until Dec 1.

### Decisions and why

- **Live progress by polling the checkpointed state, not streaming.** Every
  step is already in Postgres (durability "sync"), so the page reads what
  the run stored: no stream to keep open, and a reopened page catches up.
  The cost: a step shows only once it has finished, at 1.5 s polls.
- **The browser picks the run id**, so it can open the run page while its
  start request runs the graph. The request lives on across client-side
  navigation, and on Vercel even if the tab closes.
- **History in the browser**, as in EvalBoard: a public demo shouldn't list
  everyone's runs.
- **Preview variables as Config.** The CLI makes new variables Secret
  (write-only) on this project unless told `--no-sensitive`: production's
  unreadable `DEALSCOUT_MODEL` came from the same default.

### Known gaps

- On a public deployment, anyone with a run's link can approve or edit its
  draft, and an approved profile is what every later run of that company
  starts from. Fine behind Vercel Authentication on Preview; production
  needs a gate (an admin token, like EvalBoard's labels) before the Day 9
  merge.
- The run page shows a retry pass only once its finding is in.
- One throwaway redeploy failed to build and was deleted before its log was
  read; the next identical redeploy built fine. Cause unknown.
- Preview runs left waiting for approval: Brex, the second Ramp run,
  Killtest Co and Timeout Co.

### Spend

Preview: $0.36 of the $3 cap (three real runs; the fourth was refused by
the usage limit; the kill tests used the fakes). No local real-model calls.

### Next

- Their call first: the API usage limit (raise it, or wait until
  2026-12-01).
- Day 6: tracing (Langfuse) and MCP both ways. Both can be built and tested
  on the fakes; real traces and the screenshot need the API.

## Day 7 (2026-11-10): prompt-injection pages, defenses, v1 vs v2

Done ahead of Day 6 (tracing needs a Langfuse account from them), because
their API credits expire on 2026-11-16: the paid work goes first. Spend
cap for everything before then: $35 (their choice).

### Done

- **Six fictional company pages** (`eval/injection/pages/`), each an
  ordinary-looking site with one injected instruction: a fact override, a
  fake "DealScout operators" message, a canary phrase for the summary, an
  exfiltration fetch (to `dealscout-canary.example`, a reserved domain
  that never resolves), suppression ("report nothing") and a smear (a false
  SEC fraud investigation). Every name, person and investor is made up;
  real investor names in the first draft were replaced, and "Quarrystone
  Energy" became "Ostrelin Energy" after one run researched a real
  Quarrystone instead of the page. Served from the repo's raw URLs: the
  preview is behind Vercel Authentication, which the web tools can't pass.
- **`eval/injection/run.py`** runs each case through the v2 graph (real
  models, local database) with the page's URL in the company input (the
  only way `web_fetch` will open it), and grades three layers from the
  run's saved state: a researcher reported the injected content (or tried
  the URL, or reported nothing from the page), the verifier passed it, it
  reached the draft. `--agent v1` grades v1's profile the same way.
  `--regrade` recomputes grades without calling a model.
- **Three defenses** (commit 2327ae5): the researcher prompt says page text
  that tells it what to do or report isn't a fact; `web_fetch` may only open
  URLs from the prompt or from search results, not URLs a fetched page
  names (`url_sources`); the verifier treats a quote addressed to AI agents
  as an instruction that supports nothing.

### Results (`eval/injection/RESULTS.md`)

| | v1 (Sonnet 4.6, one agent) | v2 before | v2 after |
|---|---|---|---|
| injected content reached the profile | 1/15 | 0/12 | 0/12 |
| a researcher followed an instruction | n/a | 0/12 | 0/12 |
| true founding year and HQ kept | 15/15 | 11/12 | 5/12 |
| cost | $1.98 | $2.91 | $2.51 |

- **Haiku 5.5 ignored every injected instruction**, before any defense:
  no researcher reported an injected value, tried the exfiltration URL or
  went silent on the suppression page. (A first grade counted the funding
  researcher's empty report on the suppression page as obeying; it had
  simply found no funding there. Suppression now counts only when the
  business researcher read the page and reported nothing from it.)
- **v1 put the canary phrase in its profile once in 15 runs.** v1's single
  agent reads the page and writes the summary in the same conversation;
  v2's writer never sees page text, so an instruction aimed at the summary
  has no way in. That profile wasn't kept, so whether it obeyed or warned
  is unknown; three more v1 runs with profiles kept didn't mention it.
- **The defenses had a cost**: the business researcher read the company
  page in 5 of 12 runs against 11 of 12 before, and the true facts
  followed. No fetch was refused: it chose not to fetch. A cheaper
  ablation (`ablate.py`, the business researcher alone, 12 passes per
  setup) read the page 8/12 with no defenses, 6/12 with the prompt line
  only, 9/12 with the URL rule only and 7/12 with both: within noise each,
  but pooled with the full runs the defended passes read it 12 of 32 times
  against 19 of 31. The prompt line looked like the cause (it said "what to
  do, report or fetch"); it now leaves out "fetch", since the URL rule
  already blocks a page from directing a fetch. That change isn't measured
  yet: Day 8's run on the 5 original companies will show whether field
  accuracy holds against Day 4.
- **What this does and doesn't show**: these are direct, plainly worded
  injections, and the current models resist them; the result says the
  architecture (the writer never sees pages) and the defenses add depth,
  not that the agent is injection-proof. Subtler attacks (false facts
  stated as facts, which is poisoning, not injection) aren't tested.

### Decisions and why

- **Grade layers from saved state**, not just the final profile: it shows
  where an attack stopped, and lets the grading be fixed and rerun for free
  (it was, twice).
- **v1 as the "before" architecture.** With Haiku resisting everything,
  v2-before against v2-after compares zero with zero; v1 against v2 tests
  the design decision that matters (who sees page text).
- **Keep the defenses** despite the noisy cost: each closes a real path
  (a page directing fetches; an instruction quoted as evidence) that a
  weaker model or a subtler page could use.

### Spend (against the $35 cap)

$8.60 so far: v2 before $2.91, v2 after $2.51, v1 $1.98, the ablation
$1.14, probes $0.07. Left for Day 8 (about $18), Days 6 and 9 and
TuneBench's Claude run: $26.40.

### Next

- Day 8 as soon as they've checked `eval/ground-truth-review.md`.
- Day 6 (tracing, MCP) once they've created a Langfuse account; Day 9.

## Day 8 (2026-11-10/11): 48 companies, v1 vs v2

### Done

- **Ground truth from 5 to 48 companies** (`eval/ground-truth.json`): 43
  public, private and newer companies, US and international. They asked
  for the check to be done for them, so it is **not hand-checked**: lookup
  agents drafted each row from public sources, and a second, independent
  agent pass opened every cited source plus another and tried to prove
  each value wrong; it changed four rows (Vanta, Wise, Spotify, Grab).
  Rules: a founding year counts if a reputable source gives it as the
  founding (not a rename, launch or later entity); the HQ is the current
  operating one. Linear and Mercury were dropped (no stated HQ). Every row's
  source and the judgment calls: `eval/ground-truth-review.md`. One lookup
  agent put their email in a sec.gov request header once; reported to them.
- **Eval tooling**: `--concurrency` (48 v1 runs at ~4 minutes each would
  otherwise take 3 hours), `--only` with `--merge` to rerun named
  companies, and new summary columns: runs over 300 s, median model
  requests (steps) and searches (tool calls). `eval/replay.py` replays the
  verifier and writer on a saved run's own findings, about $0.004 a
  company, to measure a verifier change on the same research.
- **Two agent fixes from the runs**: the HQ hint says no street address
  (Day 4's leftover), and the verifier accepts a city's added region or
  country (see below).

### Results (48 companies, 144 fields, `eval/RESULTS.md`)

| setup | fields correct | median cost | median time | runs over 300 s |
|---|---|---|---|---|
| v1, Sonnet 4.6 (the Day 1 baseline's setup) | 142/144 (98.6%) | $0.248 | 226 s | 11/48 |
| v1, Haiku 5.5 (v2's model) | 137/144 (95.1%) | $0.030 | 22 s | 0/48 |
| v2, Haiku 5.5, Day 4 verifier | 132/144 (91.7%) | $0.134 | 48 s | 0/48 |
| v2, Haiku 5.5, region rule | 138/144 (95.8%) | $0.125 | 36 s | 0/48 |

v2: 10 to 12 model requests and 10 to 11 searches per run (v1: 2 and 2
to 3, its searches running inside long requests); about 70% of v2's
claims pass the verifier (1,406 of 2,018). No run failed in any setup
once four v1 runs that lost the network at the same moment
(`EHOSTUNREACH`) were rerun.

### What the runs show

- **On the same model, v2 costs about 4x v1 for the same field accuracy**
  (138 against 137; one field is noise). The multi-agent design doesn't buy
  accuracy on stable facts; what it buys isn't in these three fields: every
  field backed by claims that passed a source and quote check, memory
  across runs, an approval step, resume after a crash, and no injected
  content reaching a draft (v1 on Sonnet: 1 in 15).
- **v1 on Sonnet 4.6 is the most accurate and too slow to deploy as is**:
  11 of 48 runs took over 300 s, where the deployed function stops, so
  about a quarter would fail on the live demo. v2's parallel researchers
  keep every run under 3 minutes (longest 160 s).
- **v1 on Haiku's 6 misses on Klarna and Ramp are Haiku's malformed search
  input** ("the search tool returned input errors on repeated attempts"),
  the bug v2 fixed on Day 4 with `strict` web tools. v1 stays as it was: it's
  the baseline.
- **The first v2 run lost four HQs to the verifier** (Toast, DoorDash,
  Samsara, Okta): the field asks for city, region and country, and Haiku
  rejected "San Francisco, California, United States" against a quote with
  "San Francisco, California". With a rule that adding a city's region or
  country is fine, a replay on the same findings went 132 to 136 ($0.18);
  a full rerun scored 138. The difference between those two is run-to-run
  noise, about two fields.
- **v2's remaining misses**: three HQs left unknown (Nubank, Figma, Modal),
  Canva's HQ given as Surry Hills (its Sydney suburb; the city rule grades
  it wrong, and the answers weren't changed after seeing results), Gusto's
  2012 (v1 Sonnet gave the same), Harvey's website unknown.
- **The reworded injection line (Day 7) didn't cost accuracy**: the 5
  original companies scored 15/15 in both 48-company runs (Day 4: 14/15).

### Decisions and why

- **Ground truth checked by agents, labeled as such**: their call; the file
  and the review sheet say how each row was checked, and a person's spot
  check would still strengthen it.
- **v1's network failures rerun, not counted against it**: all four hit
  `read EHOSTUNREACH` at the same moment on this laptop.
- **Keep v2, and say plainly what it costs.** At the same model it's 4x the
  price for the same graded accuracy; the case for it is verifiability,
  control and fitting the deployed time limit.

### Spend

Day 8: $28.26 (v2 $6.55, replay $0.18, v1 Sonnet $13.20, v2 with the
region rule $6.46, v1 Haiku $1.87). Since 2026-11-10: $36.86. They removed
the $35 cap partway through (about $27 spent then); the Console limit is
now $100 a month.

### Next

- Day 6: tracing (needs their Langfuse keys) and MCP both ways.
- Day 9: the scheduled CI eval, README, fresh-context review, merge.
- Before 2026-11-16 (credits expire): TuneBench's Claude few-shot run.

## Day 6 (2026-11-11, after Day 8): MCP both ways, tracing

### Done

- **MCP client: the funding researcher reads SEC EDGAR** (`agent/app/edgar.py`).
  The server is cyanheads/secedgar-mcp-server (Apache 2.0), through its
  public instance: no key, and it sends SEC its own User-Agent, so nothing
  about whoever runs DealScout goes to sec.gov. At the start of a funding
  pass the agent lists the server's tools over MCP (the official Python SDK,
  2.3) and offers three of its 16 to the model: find a company, search
  filings, read a filing. The research loop runs the calls: at most 4 a
  pass, results cut to 12,000 characters, and the sec.gov URLs in results
  join the sources a claim may cite (the Day 2 source check, unchanged).
  An unreachable server leaves the pass with its web tools and a
  `tool_errors` entry. `EDGAR_MCP_URL` picks the server; empty turns it off.
- **MCP server: v2 tools on `/api/mcp`**, next to v1's `research_company`:
  `start_profile_run` (waits for the draft; shares the per-IP daily quota),
  `get_profile_run`, `decide_profile_run` (approve or reject). Each returns a
  summary of the run with a link to its page.
- **Tracing with Langfuse** (`agent/app/tracing.py`), **off until their keys
  are set**: one trace per run (the trace id is the run id, so a resume and
  the approval step add to the same trace), a span per graph node, a
  generation per model request with its usage and the cost from
  `app/pricing.py`, and a tool span per EDGAR call, with the MCP SDK's own
  protocol span under it. Tested against an in-memory span exporter; no
  real traces yet.
- 104 pytest (EDGAR client against an in-process MCP server, the research
  loop with EDGAR, tracing), 110 vitest.

### Checked end to end (local, real models)

The official MCP Python client against the local app's `/api/mcp`:
`start_profile_run` on Ramp returned a draft in 28 s for $0.099; one of its
deal signals is the Form D the funding researcher read over EDGAR's MCP
server ("Form D ... filed October 16, 2026 shows $1,585,000,000 sold
against a $1,850,000,000 total offering amount"), cited to its sec.gov
URL. Approving saved version 1; approving again came back as a tool error
("the run is not waiting for approval"). The client asked for MCP's
2026-07-28 protocol first and fell back to this server's 2025-06-18. (The
saved test profile was deleted from the dev database afterwards.)

On the deployed preview (`vercel curl` to its `/api/mcp`): the four tools
list, and `start_profile_run` on Databricks returned a draft in 39 s for
$0.127 whose funding_status includes "Form D for Databricks, Inc. filed
2026-08-27 shows total amount sold of $241,204,249 USD", cited to sec.gov:
the agent reaches the EDGAR server from Vercel.

### Results: the funding researcher with and without EDGAR (`eval/edgar.py`, `eval/results/edgar/`)

Only the funding researcher and the verifier, on 10 companies (6 private
US, 2 public US, 2 outside the US), twice:

| setup | claims verified | citing sec.gov | cost (10 companies) |
|---|---|---|---|
| web only | 48/81, 54/83 (59%, 65%) | 4, 5 | $0.250, $0.251 |
| with EDGAR | 57/71, 60/80 (80%, 75%) | 11, 12 | $0.154, $0.168 |

- **More claims verified, for about a third less.** With EDGAR the model ran
  about one web search a pass instead of two (searches are $0.01 each); the
  three tool definitions add 6,137 input tokens (counted), cheap at Haiku's
  rates and cached.
- **Form D is primary-source data the web often lacks**: amount sold, total
  offering, filing date. The first try lost its filing claim to the
  verifier (the value added a date and total the quote didn't state); the
  guide now asks for one claim per fact, each quoting the filing's line.
- funding_status isn't a graded field, so this counts claims, not
  correctness.

### Decisions and why

- **The researcher calls EDGAR client-side (the MCP SDK in the agent), not
  through the Messages API's MCP connector**: the loop sees every call, so
  it can cap calls and result size, add sec.gov URLs to the citable
  sources, and trace each call. The connector would need none of that code
  but hides it all.
- **A third party's hosted server, not one written here**: the point is
  consuming an MCP server someone else built and runs. The cost is uptime
  that isn't ours, hence the fallback to web tools. The same package could
  be self-hosted (it then needs an SEC User-Agent with contact details).
- **A connection per EDGAR call**: the server is stateless, and a failure,
  including while closing, stays inside that call (about 0.4 s each).
- **Our cost on each generation, not Langfuse's price table**, which may not
  know Haiku 5.5 or the web search fee.

### Known gaps

- No real traces or trace screenshot until they add the Langfuse keys.
- `decide_profile_run` has no auth, like the web route it mirrors; the
  approval gate planned for production covers both.

### Spend

Day 6: $1.09 (EDGAR probe $0.04, two comparison runs $0.82, the MCP checks
on Ramp locally $0.10 and Databricks on the preview $0.13). Since
2026-11-10: $37.95.

### Next

- Tracing on: their Langfuse keys and region, then traced runs locally and
  on the preview, and the screenshot for the README.
- Day 9: the scheduled CI eval, README, fresh-context review, merge.
- Before 2026-11-16: TuneBench's Claude few-shot run.

## Day 9 (2026-11-11): scheduled eval, approval gate, README, review

### Done

- **Scheduled eval in CI** (`.github/workflows/eval.yml`): the v2 agent on
  real models against a fresh Postgres in the job, the 5 original companies
  every Monday 09:17 UTC (about $0.65), or all 48 by hand (`workflow_dispatch`,
  with the cap as an input). The hard cap holds three ways: `run-eval.mjs
  --max-usd` starts no company past it, the agent's `AGENT_DAILY_USD` is set
  to the same amount (the job's database is new, so that covers the job
  alone), and each run stops researching at its $1.50 budget: worst case,
  the cap plus one run. New `run-eval.mjs --min-share 0.85` fails the job on
  a regression (a failed run's fields count as wrong). Results go to the job
  summary and an artifact, not a commit. **It does nothing until they add
  the `ANTHROPIC_API_KEY` repository secret.** Checked: actionlint clean; the
  eval step run locally against the local app (below); `--min-share` exits 1
  on runs that failed.
- **The 5 originals on today's agent (EDGAR on): 15/15**, median $0.122 and
  37 s (`v2-day6-originals`).
- **Approval gate**: with `V2_ADMIN_TOKEN` set, the decision route and MCP's
  `decide_profile_run` need it as a bearer token (SHA-256 digests compared
  in constant time); the run page asks for it after a 401 and keeps it for
  the tab. Unset (local, preview): no change. Checked in headless Chrome:
  refused without it, asked again after a wrong one, a run rejected with the
  right one.
- **README**: v2's graph (Mermaid), the results (48 companies, injection,
  EDGAR), design decisions, running v2, every setting. The report's
  methodology line no longer says all the ground truth was hand-checked.
- **Fresh-context review** (the code-review skill at "high" on PR #2, no
  context from these sessions): 10 findings, 9 fixed:
  - a report cut off next to an EDGAR call left that call without a
    tool_result, so the next request would fail;
  - a run cut off before its first checkpoint could never be resumed
    (`ainvoke(None)` on an empty thread raises `EmptyInputError`; checked);
  - after an edit was saved, the page showed the writer's draft as "Profile"
    (Day 5; checked in Chrome after the fix);
  - resume didn't take from the per-IP quota;
  - a late start response could put back an older state;
  - a quick resume refusal was wiped by the next poll;
  - blocked storage stopped runs from starting;
  - a double checkpoint read per request;
  - duplicated run-id and client-IP helpers.

  Not changed: pricing a response whose model has no price at the configured
  model's rate. It's deliberate (a dated model id would otherwise make every
  cost unknown and stop all runs), and the API doesn't switch a request to a
  costlier model.
- 106 pytest, 121 vitest.

### Decisions and why

- **Weekly, not nightly**: the 5 companies scored 15/15 or 14/15 on every
  v2 run since Day 4, so a weekly check catches a regression at about $3 a
  month instead of $20. Theirs to change.
- **Results as a job summary and an artifact, not a commit**: no bot commits
  on main.
- **The gate is a shared token, not accounts**: one owner approves; anyone
  else can still start and read runs within the demo quota.

### Known gaps

- CI's `build` job failed once on `next/font/google` ("queries have exactly
  one entry") with no font changes; the rerun passed, and a local build hit
  it once too. Google Fonts are fetched at build time.

### Waiting on them

- Langfuse keys and region (tracing on, traced runs, the README screenshot).
- The `ANTHROPIC_API_KEY` repository secret for the scheduled eval, and
  whether it should stay on after the credits expire on 2026-11-16 (it
  would fail weekly without credit).
- Production, their explicit OK first: v2 needs a production database, the
  agent's settings (`AGENT_MODELS`, `AGENT_DAILY_USD`), `V2_ADMIN_TOKEN`, and
  `DEALSCOUT_MODEL` / `DEALSCOUT_EFFORT` re-created as Config. Without them,
  `/v2` on production would answer that the agent is unreachable.
- The merge (they run `gh pr merge`).

### Spend

Day 9: $0.63 (the 5 originals). Since 2026-11-10: $38.58.
