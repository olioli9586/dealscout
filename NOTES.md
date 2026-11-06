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
