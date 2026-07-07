"use client";

import Link from "next/link";
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
  if (!profile) throw new Error("No profile returned");
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
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-14 sm:pt-20">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ticker">
            ▮ Batch pipeline
          </p>
          <h1 className="mt-4 font-serif text-4xl font-medium leading-tight text-bright">
            One list in, <em className="text-ticker">a pipeline</em> out.
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted">
            Paste up to {MAX_COMPANIES} company names, one per line. The agent researches
            them in sequence; export the finished profiles as CSV.
          </p>
          <p className="mt-2 font-mono text-xs text-muted">
            <Link href="/" className="underline decoration-line underline-offset-4 hover:text-ticker">
              ← single-company mode
            </Link>
          </p>
        </header>

        <form onSubmit={runBatch} className="mt-8">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={5}
            placeholder={"Ramp\nMistral AI\nNeon"}
            className="w-full resize-y border border-line bg-panel px-4 py-3 font-mono text-sm text-bright placeholder-muted/50 outline-none focus:border-ticker"
          />
          <div className="mt-3 flex items-center gap-4">
            <button
              type="submit"
              disabled={running || !input.trim()}
              className="bg-ticker px-5 py-2 font-mono text-xs font-medium uppercase tracking-widest text-ink transition hover:bg-[#f7bd63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ticker disabled:cursor-not-allowed disabled:opacity-35"
            >
              {running ? "Working…" : "Run batch"}
            </button>
            {doneCount > 0 && (
              <button
                type="button"
                onClick={downloadCsv}
                className="border border-line px-5 py-2 font-mono text-xs uppercase tracking-widest text-muted transition hover:border-ticker hover:text-ticker"
              >
                Export CSV ({doneCount})
              </button>
            )}
          </div>
        </form>

        {rows.length > 0 && (
          <section className="mt-10 border border-line bg-panel">
            <div className="border-b border-line px-4 py-2">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
                Pipeline · {doneCount}/{rows.length} complete
              </h2>
            </div>
            <ul>
              {rows.map((row, i) => (
                <li key={i} className="border-b border-line/60 px-4 py-3 last:border-b-0">
                  <div className="flex items-center gap-3 font-mono text-sm">
                    <StatusDot status={row.status} />
                    <span className="text-bright">{row.profile?.company_name ?? row.name}</span>
                    {row.profile && (
                      <span
                        className={`ml-auto text-[10px] uppercase tracking-widest ${
                          row.profile.confidence === "high"
                            ? "text-emerald-400"
                            : row.profile.confidence === "medium"
                              ? "text-ticker"
                              : "text-rose-400"
                        }`}
                      >
                        {row.profile.confidence}
                      </span>
                    )}
                    {row.status === "error" && (
                      <span className="ml-auto text-xs text-rose-400">{row.error}</span>
                    )}
                  </div>
                  {row.profile && (
                    <p className="mt-1.5 pl-6 text-[13px] leading-relaxed text-muted">
                      {row.profile.industry} · {row.profile.funding_status}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-20 flex items-center justify-between border-t border-line pt-5 font-mono text-[11px] text-muted">
          <span>Each company counts toward the daily demo limit</span>
          <a
            className="underline decoration-line underline-offset-4 transition hover:text-ticker"
            href="https://github.com/olioli9586/dealscout"
          >
            source ↗
          </a>
        </footer>
      </div>
    </main>
  );
}

function StatusDot({ status }: { status: RowStatus }) {
  if (status === "running")
    return <span className="caret-blink h-2 w-2 shrink-0 bg-ticker" aria-label="running" />;
  if (status === "done")
    return <span className="h-2 w-2 shrink-0 bg-emerald-400" aria-label="done" />;
  if (status === "error")
    return <span className="h-2 w-2 shrink-0 bg-rose-500" aria-label="error" />;
  return <span className="h-2 w-2 shrink-0 bg-line" aria-label="queued" />;
}
