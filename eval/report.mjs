// Renders eval/RESULTS.md from every eval/results/<label>.json, so v1 and
// the v2 configurations sit in one table instead of each run overwriting the
// last. run-eval.mjs calls it after each eval; `node eval/report.mjs` redoes
// it by hand.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const FIELDS = ["website_domain", "founded_year", "hq_city"];

const resultsDir = new URL("./results/", import.meta.url);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const usd = (x) => (typeof x === "number" ? `$${x.toFixed(3)}` : "—");
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "—");

function summarize(result) {
  const graded = result.rows.filter((r) => r.profile);
  const ran = result.rows.filter((r) => !r.skipped);
  const pass = graded.reduce((s, r) => s + FIELDS.filter((f) => r.fields[f]).length, 0);
  const cells = graded.length * FIELDS.length;
  const costs = ran.flatMap((r) => (typeof r.usage?.cost_usd === "number" ? [r.usage.cost_usd] : []));
  const withClaims = ran.filter((r) => r.claims);
  const supported = withClaims.reduce((s, r) => s + r.claims.supported, 0);
  const claims = withClaims.reduce((s, r) => s + r.claims.supported + r.claims.unsupported, 0);
  // Caching: actual cost against the same tokens priced uncached, over the
  // runs that report both (Day 4 on).
  const priced = ran.filter((r) => typeof r.usage?.cost_usd === "number" && typeof r.usage?.uncached_cost_usd === "number");
  const cost = priced.reduce((s, r) => s + r.usage.cost_usd, 0);
  const uncached = priced.reduce((s, r) => s + r.usage.uncached_cost_usd, 0);
  const withRetries = ran.filter((r) => typeof r.retries === "number");
  return {
    pass,
    cells,
    ran: ran.length,
    failed: result.rows.filter((r) => r.error).length,
    medianSeconds: median(ran.map((r) => r.seconds)),
    medianCost: median(costs),
    // Steps: model requests per run; tool calls: web searches per run.
    medianRequests: median(ran.flatMap((r) => (typeof r.usage?.requests === "number" ? [r.usage.requests] : []))),
    medianSearches: median(
      ran.flatMap((r) => (typeof r.usage?.web_search_requests === "number" ? [r.usage.web_search_requests] : [])),
    ),
    claims: withClaims.length ? `${supported}/${claims} (${pct(supported, claims)})` : "—",
    cacheSaved: priced.length && uncached > 0 ? `${(100 * (1 - cost / uncached)).toFixed(1)}%` : "—",
    retries: withRetries.length ? withRetries.reduce((s, r) => s + r.retries, 0) : "—",
  };
}

// "40/52 (5 source, 7 quote)": supported over all, and why the rest failed.
function claimsCell(c) {
  if (!c) return "—";
  const why = c.rejected ? ` (${c.rejected.source} source, ${c.rejected.quote} quote)` : "";
  return `${c.supported}/${c.supported + c.unsupported}${c.unsupported ? why : ""}`;
}

function agent(result) {
  if (result.api === "v2") return result.models ?? "unknown";
  return result.model ? `\`${result.model}\`, effort \`${result.effort}\`` : "unknown";
}

export function writeReport() {
  const results = readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(new URL(f, resultsDir))))
    // v1 first (the baseline), then the rest in the order they ran.
    .sort((a, b) => (a.label === "v1" ? -1 : b.label === "v1" ? 1 : a.date.localeCompare(b.date) || a.label.localeCompare(b.label)));

  let md = `# DealScout Accuracy Eval

Methodology (borrowed from [EvalBoard](https://github.com/olioli9586/evalboard)):
hand-checked ground truth, mechanical field grading with accepted-value lists,
every result reproducible via \`node eval/run-eval.mjs <base-url> --label <label> [--api v2]\`.
Raw rows, profiles included: \`eval/results/<label>.json\`.

| label | agent | date | fields correct | failed runs | median time | median cost | total cost | median model requests | median searches | saved by caching | claims supported | retried branches |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
`;
  for (const r of results) {
    const s = summarize(r);
    md += `| ${r.label} | ${r.api === "v2" ? "v2" : "v1"}: ${agent(r)} | ${r.date} | ${s.pass}/${s.cells} (${pct(s.pass, s.cells)}) | ${s.failed}/${s.ran} | ${s.medianSeconds ?? "—"} s | ${usd(s.medianCost)} | ${usd(r.spent_usd)} | ${s.medianRequests ?? "—"} | ${s.medianSearches ?? "—"} | ${s.cacheSaved} | ${s.claims} | ${s.retries} |\n`;
  }

  for (const r of results) {
    const s = summarize(r);
    md += `\n## ${r.label}\n\nAgent: ${r.api === "v2" ? "v2, " : "v1, "}${agent(r)}. Base: \`${r.base}\`. Spend cap: ${usd(r.max_usd)}.\n`;
    if (r.stopped) md += `\nStopped early: ${r.stopped}.\n`;
    md += `
| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
`;
    for (const row of r.rows) {
      const cell = (f) => (row.skipped ? "skipped" : row.error ? "⚠️ run failed" : row.fields[f] ? "✅" : "❌");
      const u = row.usage;
      md += `| ${row.name} | ${FIELDS.map(cell).join(" | ")} | ${row.skipped ? "—" : row.seconds + "s"} | ${usd(u?.cost_usd)} | ${u?.requests ?? "—"} | ${u?.web_search_requests ?? "—"} | ${u?.web_fetch_requests ?? "—"} | ${claimsCell(row.claims)} |\n`;
    }
    md += `\n${s.pass}/${s.cells} fields correct. `;
    md += FIELDS.map((f) => `${f}: ${r.rows.filter((x) => x.profile && x.fields[f]).length}/${r.rows.filter((x) => x.profile).length}`).join(", ");
    md += ".\n";
    const remembered = r.rows.filter((row) => row.memory?.previous_version);
    if (remembered.length) {
      md += `
Memory: these runs started from a saved profile.

| company | from version | areas researched | carried over | changed fields |
|---|---|---|---|---|
`;
      for (const row of remembered) {
        const m = row.memory;
        const changed = m.changes?.length ? m.changes.map((c) => c.field).join(", ") : "none";
        md += `| ${row.name} | ${m.previous_version} | ${row.plan?.join(", ") || "—"} | ${m.carried_over.join(", ") || "none"} | ${changed} |\n`;
      }
    }
  }

  md += `
Notes:
- Fields were chosen for *stability* (a website or founding year doesn't move);
  volatile fields (employee counts, funding) need dated ground truth to grade fairly.
- Cost is computed from the token and web-search counts the API reports on each
  response (lib/pricing.ts for v1, agent/app/pricing.py for v2, same table); run
  time is wall clock as seen by the eval script.
- v2 "claims supported": claims that passed the verifier, over all claims the
  researchers reported. Day 3 runs count each branch's final pass and had
  only the source check (the cited URL must be one the run's web tools
  returned). From Day 4 a model also checks that each quote supports its
  value, and every pass counts, retries included, since the writer uses them
  all. The per-company cells say how many failed each check. v1 has no
  claims, so no number.
- "saved by caching": 1 - cost / the same tokens priced with nothing cached.
  Caching doesn't change what the model does, so this is exact for those
  runs, not a comparison between two noisy runs.
- "retried branches": research passes after the first, over all runs.
- Failures worth reading: when the agent misses, the profile usually shows *why*
  (e.g. remote-first companies genuinely have ambiguous HQs).
`;
  writeFileSync(new URL("./RESULTS.md", import.meta.url), md);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) writeReport();
