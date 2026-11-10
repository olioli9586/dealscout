"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge, timeAgo, usd } from "@/app/v2/ui";
import { launch, listRuns, readHistory, type RunSummary } from "@/lib/v2-client";

const STEPS = [
  ["Plan", "picks the research areas the company needs"],
  ["Research", "up to four researchers search the web in parallel"],
  ["Verify", "every claim needs a page the run saw and a quote that backs it"],
  ["Write", "a profile from verified claims only"],
  ["Approve", "you approve, edit or reject it before it's saved"],
];

export default function V2Home() {
  const router = useRouter();
  const [company, setCompany] = useState("");
  // null until the history has loaded from this browser.
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    listRuns(readHistory(localStorage))
      .then((list) => {
        setRuns(list);
        setNow(Date.now());
      })
      .catch((err) => {
        setRuns([]);
        setError(`Couldn't load your runs: ${(err as Error).message}`);
      });
  }, []);

  function start(e: React.FormEvent) {
    e.preventDefault();
    const name = company.trim();
    if (!name) return;
    router.push(`/v2/runs/${launch(name, localStorage)}`);
  }

  return (
    <main className="flex-1">
      <section className="dot-grid bg-navy">
        <div className="mx-auto w-full max-w-3xl px-6 pb-12 pt-12 sm:pt-16">
          <p className="font-mono text-xs uppercase tracking-wider text-mint">v2 · multi-agent</p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-[2.75rem]">
            Research, checked,
            <br />
            then approved by you.
          </h1>
          <ol className="mt-5 grid max-w-xl gap-1.5 text-[14px] text-white/70">
            {STEPS.map(([step, what], i) => (
              <li key={step} className="flex gap-3">
                <span className="w-4 shrink-0 font-mono text-xs leading-6 text-white/35">{i + 1}</span>
                <span>
                  <span className="font-medium text-white">{step}</span>: {what}
                </span>
              </li>
            ))}
          </ol>

          <form onSubmit={start} className="mt-7">
            <label htmlFor="company" className="sr-only">
              Company name
            </label>
            <div className="flex max-w-xl gap-2">
              <input
                id="company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Company name"
                autoComplete="off"
                maxLength={200}
                className="h-11 min-w-0 flex-1 rounded-md border border-white/20 bg-white px-3.5 text-[15px] text-ink outline-none transition placeholder:text-soft/70 focus:border-mint focus:ring-2 focus:ring-mint/30"
              />
              <button
                type="submit"
                disabled={!company.trim()}
                className="h-11 shrink-0 rounded-md bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start a run
              </button>
            </div>
          </form>
        </div>
      </section>

      <div className="mx-auto w-full max-w-3xl px-6 pb-20 pt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[13px] font-medium text-soft">Your runs</h2>
          <span className="text-xs text-soft/70">Kept in this browser</span>
        </div>
        {error && (
          <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {runs === null ? (
          <p className="mt-2 text-[13px] text-soft">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-edge-strong px-6 py-8 text-center text-[13px] text-soft">
            No runs yet. Start one above; it will be listed here.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-edge overflow-hidden rounded-lg border border-edge bg-surface shadow-sm">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/v2/runs/${run.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition hover:bg-canvas"
                >
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{run.company}</span>
                  <StatusBadge status={run.status} resumable={run.resumable} />
                  <span className="w-16 text-right font-mono text-xs text-soft">{usd(run.cost_usd)}</span>
                  <span className="w-20 text-right text-xs text-soft">{timeAgo(run.created_at, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
