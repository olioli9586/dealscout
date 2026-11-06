// DealScout accuracy eval — the EvalBoard methodology applied to the agent.
//
// For each ground-truth company: run the agent, extract the three stable
// fields (website domain, founded year, HQ city), and grade against
// hand-checked accepted values. Also records what each run cost and how much
// work it did (API requests, web searches, fetches), from the usage event the
// agent sends at the end of every run. Prints a per-company readout and writes
// eval/results/<label>.json and eval/RESULTS.md.
//
// Usage:  node eval/run-eval.mjs [base-url] [--label v1] [--max-usd 5]
//         (base-url defaults to production)
//
// --max-usd is a hard spend cap: no new company starts once the runs so far
// cost that much, and a run that reports no cost stops the eval, because the
// cap can't be enforced without it. One run is bounded by the agent's own
// limits (web tool max_uses, iteration cap), so the overshoot is one run.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    label: { type: "string", default: "v1" },
    "max-usd": { type: "string", default: "5" },
  },
});
const BASE = positionals[0] ?? "https://dealscout-gamma.vercel.app";
const MAX_USD = Number(opts["max-usd"]);
if (!Number.isFinite(MAX_USD) || MAX_USD <= 0) throw new Error("--max-usd must be a positive number");
if (!/^[\w.-]+$/.test(opts.label)) throw new Error("--label may only use letters, digits, '.', '_' and '-'");
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
    run = await research(gt.name);
  } catch (err) {
    run = { profile: null, usage: null, error: err.message };
  }
  const row = {
    name: gt.name,
    seconds: Math.round((Date.now() - started) / 1000),
    usage: run.usage,
    fields: {},
  };
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
const perField = fields.map((f) => ({
  field: f,
  pass: graded.filter((r) => r.fields[f]).length,
  total: graded.length,
}));
const totalPass = perField.reduce((s, x) => s + x.pass, 0);
const totalCells = perField.reduce((s, x) => s + x.total, 0);
const ran = rows.filter((r) => !r.skipped);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const config = ran.find((r) => r.usage)?.usage;
const date = new Date().toISOString().slice(0, 10);

const resultsDir = new URL("./results/", import.meta.url);
mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  new URL(`${opts.label}.json`, resultsDir),
  JSON.stringify(
    {
      label: opts.label,
      date,
      base: BASE,
      model: config?.model ?? null,
      effort: config?.effort ?? null,
      max_usd: MAX_USD,
      spent_usd: spent,
      stopped,
      rows,
    },
    null,
    2,
  ) + "\n",
);

const usd = (x) => (typeof x === "number" ? `$${x.toFixed(3)}` : "—");
let md = `# DealScout Accuracy Eval — ${opts.label}, ${date}

Methodology (borrowed from [EvalBoard](https://github.com/olioli9586/evalboard)):
hand-checked ground truth, mechanical field grading with accepted-value lists,
every result reproducible via \`node eval/run-eval.mjs <base-url> --label ${opts.label}\`.
Raw rows, profiles included: [results/${opts.label}.json](results/${opts.label}.json).

Agent: ${config ? `\`${config.model}\`, effort \`${config.effort}\`` : "unknown (no usage reported)"}.

**Overall: ${totalPass}/${totalCells} fields correct (${Math.round((100 * totalPass) / Math.max(1, totalCells))}%)**
· ${ran.length} runs, ${rows.filter((r) => r.error).length} failed
· median ${median(ran.map((r) => r.seconds)) ?? "—"} s per run
· ${usd(spent)} total, median ${usd(median(ran.flatMap((r) => (typeof r.usage?.cost_usd === "number" ? [r.usage.cost_usd] : []))))} per run
${stopped ? `\nStopped early: ${stopped}.\n` : ""}
| company | website | founded | HQ city | run time | cost | API requests | searches | fetches |
|---|---|---|---|---|---|---|---|---|
`;
for (const r of rows) {
  const cell = (f) => (r.skipped ? "skipped" : r.error ? "⚠️ run failed" : r.fields[f] ? "✅" : "❌");
  const u = r.usage;
  md += `| ${r.name} | ${cell("website_domain")} | ${cell("founded_year")} | ${cell("hq_city")} | ${r.skipped ? "—" : r.seconds + "s"} | ${usd(u?.cost_usd)} | ${u?.requests ?? "—"} | ${u?.web_search_requests ?? "—"} | ${u?.web_fetch_requests ?? "—"} |\n`;
}
md += `\n| field | accuracy |\n|---|---|\n`;
for (const x of perField) md += `| ${x.field} | ${x.pass}/${x.total} |\n`;
md += `
Notes:
- Fields were chosen for *stability* (a website or founding year doesn't move);
  volatile fields (employee counts, funding) need dated ground truth to grade fairly.
- Cost is computed from the token and web-search counts the API reports on each
  response (lib/pricing.ts); run time is wall clock as seen by this script.
- Failures worth reading: when the agent misses, the profile usually shows *why*
  (e.g. remote-first companies genuinely have ambiguous HQs).
`;
writeFileSync(new URL("./RESULTS.md", import.meta.url), md);
console.log(`\n${totalPass}/${totalCells} fields correct, ${usd(spent)} spent — wrote eval/RESULTS.md and eval/results/${opts.label}.json`);
