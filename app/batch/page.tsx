"use client";

import { useState } from "react";
import type { AgentEvent, CompanyProfile } from "@/lib/agent";

const MAX_COMPANIES = 10;

type RowStatus = "queued" | "running" | "done" | "error";

interface Row {
  name: string;
  status: RowStatus;
  profile?: CompanyProfile;
  error?: string;
}

async function researchOne(name: string): Promise<CompanyProfile> {
  const res = await fetch("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company: name }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let profile: CompanyProfile | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as AgentEvent;
      if (event.type === "profile") profile = event.profile;
      if (event.type === "error") throw new Error(event.message);
    }
  }
  if (!profile) throw new Error("Hit the server time limit — retry this one");
  return profile;
}

function toCsv(rows: Row[]): string {
  const cols: (keyof CompanyProfile)[] = [
    "company_name", "website", "industry", "hq_location", "founded_year",
    "employee_count", "business_model", "products_services", "funding_status",
    "recent_news", "deal_signals", "confidence", "summary",
  ];
  const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const header = cols.join(",");
  const lines = rows
    .filter((r) => r.profile)
    .map((r) =>
      cols
        .map((c) => {
          const v = r.profile![c];
          return esc(Array.isArray(v) ? v.join("; ") : String(v));
        })
        .join(","),
    );
  return [header, ...lines].join("\n");
}

export default function BatchPage() {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  const doneCount = rows.filter((r) => r.status === "done").length;

  async function runBatch(e: React.FormEvent) {
    e.preventDefault();
    const names = [
      ...new Set(
        input
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ].slice(0, MAX_COMPANIES);
    if (names.length === 0 || running) return;

    setRunning(true);
    setRows(names.map((name) => ({ name, status: "queued" as const })));

    // Sequential on purpose: keeps per-visitor cost predictable and stays
    // inside the demo rate limit. Concurrency would be a one-line change.
    for (let i = 0; i < names.length; i++) {
      setRows((prev) => prev.map((r, j) => (j === i ? { ...r, status: "running" } : r)));
      try {
        const profile = await researchOne(names[i]);
        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, status: "done", profile } : r)));
      } catch (err) {
        setRows((prev) =>
          prev.map((r, j) =>
            j === i ? { ...r, status: "error", error: (err as Error).message } : r,
          ),
        );
        // A rate-limit error will hit every remaining row too — stop early.
        if ((err as Error).message.toLowerCase().includes("limit")) break;
      }
    }
    setRunning(false);
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dealscout-batch.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="flex-1">
      <section className="dot-grid bg-navy">
        <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:py-12">
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">
            Batch research
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/70">
            Paste up to {MAX_COMPANIES} company names, one per line. DealScout
            researches them in order, and you can download the finished
            profiles as a CSV.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-3xl px-6 pb-20">
        <form onSubmit={runBatch} className="mt-8">
          <label htmlFor="companies" className="sr-only">
            Company names, one per line
          </label>
          <textarea
            id="companies"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={5}
            placeholder={"Ramp\nMistral AI\nNeon"}
            className="w-full resize-y rounded-md border border-edge-strong bg-surface px-3 py-2.5 text-[15px] leading-relaxed text-ink outline-none transition placeholder:text-soft/70 focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-1.5 text-xs text-soft">
            Each company counts toward the daily demo limit.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={running || !input.trim()}
              className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-white transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Running…" : "Run batch"}
            </button>
            {doneCount > 0 && (
              <button
                type="button"
                onClick={downloadCsv}
                className="h-10 rounded-md border border-edge-strong bg-surface px-4 text-sm font-medium text-ink transition hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Download CSV ({doneCount})
              </button>
            )}
          </div>
        </form>

        {rows.length > 0 && (
          <section className="mt-8 overflow-hidden rounded-lg border border-edge bg-surface">
            <div className="border-b border-edge px-4 py-2.5">
              <h2 className="text-[13px] font-medium text-ink">
                Results
                <span className="ml-2 font-mono text-xs font-normal text-soft">
                  {doneCount}/{rows.length} complete
                </span>
              </h2>
            </div>
            <ul>
              {rows.map((row, i) => (
                <li key={i} className="border-b border-edge px-4 py-3 last:border-b-0">
                  <div className="flex items-center gap-3 text-sm">
                    <StatusDot status={row.status} />
                    <span className="font-medium text-ink">
                      {row.profile?.company_name ?? row.name}
                    </span>
                    {row.profile && (
                      <span
                        className={`ml-auto text-xs font-medium ${
                          row.profile.confidence === "high"
                            ? "text-emerald-700"
                            : row.profile.confidence === "medium"
                              ? "text-amber-700"
                              : "text-red-600"
                        }`}
                      >
                        {row.profile.confidence[0].toUpperCase() +
                          row.profile.confidence.slice(1)}{" "}
                        confidence
                      </span>
                    )}
                    {row.status === "error" && (
                      <span className="ml-auto text-xs text-red-600">{row.error}</span>
                    )}
                  </div>
                  {row.profile && (
                    <p className="mt-1 pl-5 text-[13px] leading-relaxed text-soft">
                      {row.profile.industry} · {row.profile.funding_status}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function StatusDot({ status }: { status: RowStatus }) {
  if (status === "running")
    return <span className="pulse-dot h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="running" />;
  if (status === "done")
    return <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-label="done" />;
  if (status === "error")
    return <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-label="error" />;
  return <span className="h-2 w-2 shrink-0 rounded-full bg-edge-strong" aria-label="queued" />;
}
