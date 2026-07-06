"use client";

import { useRef, useState } from "react";
import type { AgentEvent, CompanyProfile } from "@/lib/agent";

type Phase = "idle" | "running" | "done" | "error";

export default function Home() {
  const [company, setCompany] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [narrative, setNarrative] = useState("");
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function runResearch(e: React.FormEvent) {
    e.preventDefault();
    if (!company.trim() || phase === "running") return;

    setPhase("running");
    setStatuses([]);
    setNarrative("");
    setProfile(null);
    setError("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: company.trim() }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AgentEvent;
          if (event.type === "status") {
            setStatuses((prev) =>
              prev[prev.length - 1] === event.message ? prev : [...prev, event.message],
            );
          } else if (event.type === "text") {
            setNarrative((prev) => prev + event.text);
          } else if (event.type === "profile") {
            setProfile(event.profile);
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
      setPhase("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setPhase("error");
    }
  }

  return (
    <main className="min-h-screen bg-[#0b1120] text-slate-200">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-white">
            DealScout
            <span className="ml-3 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 align-middle text-xs font-medium text-emerald-300">
              research agent
            </span>
          </h1>
          <p className="mt-3 text-slate-400">
            Type a company name. An autonomous agent searches the web, reads sources, and
            returns a structured deal-sourcing profile — watch it work in real time.
          </p>
        </header>

        <form onSubmit={runResearch} className="flex gap-3">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Ramp, Mistral AI, Rippling…"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={phase === "running" || !company.trim()}
            className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase === "running" ? "Researching…" : "Research"}
          </button>
        </form>

        {statuses.length > 0 && (
          <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Agent activity
            </h2>
            <ol className="space-y-1.5 text-sm">
              {statuses.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-slate-400">
                  <span
                    className={
                      phase === "running" && i === statuses.length - 1
                        ? "h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"
                        : "h-1.5 w-1.5 rounded-full bg-slate-600"
                    }
                  />
                  {s}
                </li>
              ))}
            </ol>
          </section>
        )}

        {narrative && (
          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Notes
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{narrative}</p>
          </section>
        )}

        {profile && (
          <section className="mt-6 overflow-hidden rounded-xl border border-emerald-700/40">
            <div className="border-b border-emerald-700/40 bg-emerald-500/10 px-5 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-bold text-white">{profile.company_name}</h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    profile.confidence === "high"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : profile.confidence === "medium"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-rose-500/20 text-rose-300"
                  }`}
                >
                  {profile.confidence} confidence
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{profile.summary}</p>
            </div>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 bg-slate-900/60 p-5 sm:grid-cols-2">
              <Field label="Website" value={profile.website} />
              <Field label="Industry" value={profile.industry} />
              <Field label="Headquarters" value={profile.hq_location} />
              <Field label="Founded" value={profile.founded_year} />
              <Field label="Employees" value={profile.employee_count} />
              <Field label="Funding" value={profile.funding_status} />
              <Field label="Business model" value={profile.business_model} wide />
              <ListField label="Products & services" items={profile.products_services} />
              <ListField label="Recent news" items={profile.recent_news} />
              <ListField label="Deal signals" items={profile.deal_signals} highlight />
            </dl>
          </section>
        )}

        {error && (
          <p className="mt-6 rounded-xl border border-rose-800 bg-rose-950/50 p-4 text-sm text-rose-300">
            {error}
          </p>
        )}

        <footer className="mt-16 text-center text-xs text-slate-600">
          Built with Next.js + the Claude API (server-side web search) ·{" "}
          <a
            className="underline hover:text-slate-400"
            href="https://github.com/olioli9586/dealscout"
          >
            source on GitHub
          </a>
        </footer>
      </div>
    </main>
  );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-200">{value || "unknown"}</dd>
    </div>
  );
}

function ListField({
  label,
  items,
  highlight,
}: {
  label: string;
  items: string[];
  highlight?: boolean;
}) {
  return (
    <div className="sm:col-span-2">
      <dt className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="mt-1">
        {items.length === 0 ? (
          <span className="text-sm text-slate-500">unknown</span>
        ) : (
          <ul className="space-y-1">
            {items.map((item, i) => (
              <li
                key={i}
                className={`text-sm ${highlight ? "text-emerald-200" : "text-slate-200"}`}
              >
                • {item}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
