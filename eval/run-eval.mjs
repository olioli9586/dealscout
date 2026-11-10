// DealScout accuracy eval — the EvalBoard methodology applied to the agent.
//
// For each ground-truth company: run the agent, extract the three stable
// fields (website domain, founded year, HQ city), and grade against
// hand-checked accepted values. Also records what each run cost and how much
// work it did (API requests, web searches, fetches), from the usage event the
// agent sends at the end of every run. Prints a per-company readout and writes
// eval/results/<label>.json, then eval/RESULTS.md from every saved result
// (eval/report.mjs).
//
// Usage:  node eval/run-eval.mjs [base-url] [--label v1] [--max-usd 5] [--api v1|v2] [--approve]
//         (base-url defaults to production)
//
// --api v2 starts each company as a v2 run (POST /api/v2/runs, the LangGraph
// agent behind the Next.js app) and grades the draft it stops at for
// approval. By default the eval never approves, so no profile is saved and
// every run starts without memory: runs stay comparable. --approve saves
// each draft as it is, so the next eval of the same companies runs with
// memory (that is how the memory runs were made; clear the profiles table
// afterwards for memory-free runs again).
//
// --max-usd is a hard spend cap: no new company starts once the runs so far
// cost that much, and a run that reports no cost stops the eval, because the
// cap can't be enforced without it. One run is bounded by the agent's own
// limits (web tool max_uses, iteration cap), so the overshoot is one run.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { writeReport } from "./report.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    label: { type: "string", default: "v1" },
    "max-usd": { type: "string", default: "5" },
    api: { type: "string", default: "v1" },
    approve: { type: "boolean", default: false },
  },
});
const BASE = positionals[0] ?? "https://dealscout-gamma.vercel.app";
const MAX_USD = Number(opts["max-usd"]);
if (!Number.isFinite(MAX_USD) || MAX_USD <= 0) throw new Error("--max-usd must be a positive number");
if (!/^[\w.-]+$/.test(opts.label)) throw new Error("--label may only use letters, digits, '.', '_' and '-'");
if (!["v1", "v2"].includes(opts.api)) throw new Error("--api must be v1 or v2");
if (opts.approve && opts.api !== "v2") throw new Error("--approve is for --api v2 runs");
const truth = JSON.parse(readFileSync(new URL("./ground-truth.json", import.meta.url)));

async function research(company) {
  const res = await fetch(`${BASE}/api/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let profile = null;
  let usage = null;
  let error = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "profile") profile = event.profile;
      if (event.type === "usage") usage = event.usage;
      // Keep reading after an error: the usage event comes last.
      if (event.type === "error") error = event.message;
    }
  }
  if (!error && !profile) error = "no profile (stream ended early)";
  return { profile, usage, error };
}

// "planner claude-haiku-5-5 (low), researcher ..." from a v2 run's calls.
function modelsOf(calls) {
  const seen = new Map();
  for (const c of calls) if (!seen.has(c.node)) seen.set(c.node, `${c.node} \`${c.model}\` (${c.effort ?? "?"})`);
  return [...seen.values()].join(", ") || null;
}

async function researchV2(company) {
  const res = await fetch(`${BASE}/api/v2/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company }),
  });
  const run = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${run.error ?? "no body"}`);
  const usage = run.usage
    ? {
        model: modelsOf(run.usage.calls),
        effort: null,
        requests: run.usage.requests,
        input_tokens: run.usage.input_tokens,
        output_tokens: run.usage.output_tokens,
        cache_creation_input_tokens: run.usage.cache_creation_input_tokens,
        cache_read_input_tokens: run.usage.cache_read_input_tokens,
        web_search_requests: run.usage.web_search_requests,
        web_fetch_requests: run.usage.web_fetch_requests,
        cost_usd: run.usage.cost_usd,
        // The same tokens priced with nothing cached: what caching saved.
        uncached_cost_usd: run.usage.uncached_cost_usd,
      }
    : null;
  // Every pass of every branch: the writer chooses from all of them (from
  // Day 4; Day 3 runs counted only each branch's last pass).
  const passes = run.verdicts ?? [];
  const rejectedBy = (check) => passes.reduce((s, v) => s + (v.rejected ?? []).filter((r) => r.check === check).length, 0);
  const claims = {
    supported: passes.reduce((s, v) => s + v.supported, 0),
    unsupported: passes.reduce((s, v) => s + v.unsupported, 0),
    // Why: the cited URL wasn't one the tools returned, or the quote doesn't support the value.
    rejected: { source: rejectedBy("source"), quote: rejectedBy("quote") },
  };
  // Every pass, retries included: how often the verifier sent a branch back.
  const retries = (run.verdicts ?? []).filter((v) => v.attempt > 1).length;
  const error =
    run.status === "awaiting_approval" && run.draft ? null : (run.error ?? `run ended with status ${run.status}`);
  const memory = {
    previous_version: run.previous_version ?? null,
    changes: run.changes ?? null,
    carried_over: run.draft?.carried_over ?? [],
  };
  if (opts.approve && !error) {
    const res = await fetch(`${BASE}/api/v2/runs/${run.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    const saved = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`approve: HTTP ${res.status}: ${saved.error ?? "no body"}`);
    memory.saved_version = saved.saved_version;
  }
  return { profile: run.draft ?? null, usage, error, run_id: run.id, plan: run.plan, claims, retries, memory };
}

const norm = (s) => String(s ?? "").toLowerCase();
const graders = {
  website_domain: (p, accepted) => accepted.some((d) => norm(p.website).includes(d)),
  founded_year: (p, accepted) => accepted.some((y) => norm(p.founded_year).includes(y)),
  hq_city: (p, accepted) => accepted.some((c) => norm(p.hq_location).includes(c)),
};

const rows = [];
let spent = 0;
let stopped = null;
for (const gt of truth.companies) {
  if (stopped) {
    rows.push({ name: gt.name, skipped: stopped, fields: {} });
    continue;
  }
  process.stdout.write(`researching ${gt.name}… `);
  const started = Date.now();
  let run;
  try {
    run = await (opts.api === "v2" ? researchV2(gt.name) : research(gt.name));
  } catch (err) {
    run = { profile: null, usage: null, error: err.message };
  }
  const row = {
    name: gt.name,
    seconds: Math.round((Date.now() - started) / 1000),
    usage: run.usage,
    fields: {},
  };
  if (opts.api === "v2")
    Object.assign(row, {
      run_id: run.run_id,
      plan: run.plan,
      claims: run.claims,
      retries: run.retries,
      memory: run.memory,
    });
  if (run.error) row.error = run.error;
  else {
    for (const [field, grade] of Object.entries(graders)) row.fields[field] = grade(run.profile, gt[field]);
    row.profile = run.profile;
  }
  rows.push(row);
  const cost = run.usage?.cost_usd;
  if (typeof cost === "number") spent += cost;
  console.log(
    `${row.seconds}s`,
    typeof cost === "number" ? `$${cost.toFixed(3)}` : "cost unknown",
    row.error ? `FAILED: ${row.error}` : row.fields,
  );
  if (typeof cost !== "number") stopped = "the previous run reported no cost, so the spend cap can't be enforced";
  else if (spent >= MAX_USD) stopped = `spend cap $${MAX_USD} reached`;
}
if (stopped) console.log(`stopped early: ${stopped}`);

const fields = Object.keys(graders);
const graded = rows.filter((r) => r.profile);
const totalPass = graded.reduce((s, r) => s + fields.filter((f) => r.fields[f]).length, 0);
const totalCells = graded.length * fields.length;
const config = rows.find((r) => r.usage)?.usage;
const date = new Date().toISOString().slice(0, 10);

const resultsDir = new URL("./results/", import.meta.url);
mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  new URL(`${opts.label}.json`, resultsDir),
  JSON.stringify(
    {
      label: opts.label,
      api: opts.api,
      date,
      base: BASE,
      // v1: one model and effort. v2: every node's model and effort.
      ...(opts.api === "v2"
        ? { models: config?.model ?? null }
        : { model: config?.model ?? null, effort: config?.effort ?? null }),
      max_usd: MAX_USD,
      spent_usd: spent,
      stopped,
      rows,
    },
    null,
    2,
  ) + "\n",
);

writeReport();
const usd = (x) => (typeof x === "number" ? `$${x.toFixed(3)}` : "—");
console.log(`\n${totalPass}/${totalCells} fields correct, ${usd(spent)} spent — wrote eval/results/${opts.label}.json and eval/RESULTS.md`);
