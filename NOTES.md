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
