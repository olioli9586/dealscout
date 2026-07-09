// DealScout accuracy eval — the EvalBoard methodology applied to the agent.
//
// For each ground-truth company: run the deployed agent, extract the three
// stable fields (website domain, founded year, HQ city), and grade against
// hand-checked accepted values. Prints a per-field readout and writes
// eval/RESULTS.md.
//
// Usage:  node eval/run-eval.mjs [base-url]     (default: production)

import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "https://dealscout-gamma.vercel.app";
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
      if (event.type === "error") throw new Error(event.message);
    }
  }
  if (!profile) throw new Error("no profile (stream ended early)");
  return profile;
}

const norm = (s) => String(s ?? "").toLowerCase();
const graders = {
  website_domain: (p, accepted) => accepted.some((d) => norm(p.website).includes(d)),
  founded_year: (p, accepted) => accepted.some((y) => norm(p.founded_year).includes(y)),
  hq_city: (p, accepted) => accepted.some((c) => norm(p.hq_location).includes(c)),
};

const rows = [];
for (const gt of truth.companies) {
  process.stdout.write(`researching ${gt.name}… `);
  const started = Date.now();
  try {
    const p = await research(gt.name);
    const row = { name: gt.name, seconds: Math.round((Date.now() - started) / 1000), fields: {}, profile: p };
    for (const [field, grade] of Object.entries(graders)) {
      row.fields[field] = grade(p, gt[field]);
    }
    rows.push(row);
    console.log(`${row.seconds}s`, row.fields);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    rows.push({ name: gt.name, error: err.message, fields: {} });
  }
}

const fields = Object.keys(graders);
const perField = fields.map((f) => {
  const graded = rows.filter((r) => !r.error);
  const pass = graded.filter((r) => r.fields[f]).length;
  return { field: f, pass, total: graded.length };
});
const totalPass = perField.reduce((s, x) => s + x.pass, 0);
const totalCells = perField.reduce((s, x) => s + x.total, 0);

let md = `# DealScout Accuracy Eval — ${new Date().toISOString().slice(0, 10)}

Methodology (borrowed from [EvalBoard](https://github.com/olioli9586/evalboard)):
hand-checked ground truth, mechanical field grading with accepted-value lists,
every result reproducible via \`node eval/run-eval.mjs\`.

**Overall: ${totalPass}/${totalCells} fields correct (${Math.round((100 * totalPass) / Math.max(1, totalCells))}%)**

| company | website | founded | HQ city | run time |
|---|---|---|---|---|
`;
for (const r of rows) {
  const cell = (f) => (r.error ? "⚠️ run failed" : r.fields[f] ? "✅" : "❌");
  md += `| ${r.name} | ${cell("website_domain")} | ${cell("founded_year")} | ${cell("hq_city")} | ${r.error ? "—" : r.seconds + "s"} |\n`;
}
md += `\n| field | accuracy |\n|---|---|\n`;
for (const x of perField) md += `| ${x.field} | ${x.pass}/${x.total} |\n`;
md += `
Notes:
- Fields were chosen for *stability* (a website or founding year doesn't move);
  volatile fields (employee counts, funding) need dated ground truth to grade fairly.
- Failures worth reading: when the agent misses, the profile usually shows *why*
  (e.g. remote-first companies genuinely have ambiguous HQs).
`;
writeFileSync(new URL("./RESULTS.md", import.meta.url), md);
console.log(`\n${totalPass}/${totalCells} fields correct — wrote eval/RESULTS.md`);
