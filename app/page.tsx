"use client";

import { useRef, useState } from "react";
import type { AgentEvent, CompanyProfile } from "@/lib/agent";

type Phase = "idle" | "running" | "done" | "error";

interface LogLine {
  at: string; // elapsed, e.g. "0:04"
  text: string;
}

const EXAMPLES = ["Ramp", "Mistral AI", "Anduril", "Neon"];

function elapsed(since: number): string {
  const s = Math.floor((Date.now() - since) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Home() {
  const [company, setCompany] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [thought, setThought] = useState("");
  const [narrative, setNarrative] = useState("");
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [error, setError] = useState("");
  const startRef = useRef(0);

  async function run(name: string) {
    if (!name.trim() || phase === "running") return;
    setCompany(name);
    setPhase("running");
    setLog([]);
    setThought("");
    setNarrative("");
    setProfile(null);
    setError("");
    startRef.current = Date.now();

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: name.trim() }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotProfile = false;

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
            const at = elapsed(startRef.current);
            setLog((prev) =>
              prev[prev.length - 1]?.text === event.message
                ? prev
                : [...prev, { at, text: event.message }],
            );
            setThought("");
          } else if (event.type === "thinking") {
            setThought((prev) => (prev + event.text).slice(-160));
          } else if (event.type === "text") {
            setNarrative((prev) => prev + event.text);
          } else if (event.type === "profile") {
            setProfile(event.profile);
            gotProfile = true;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
      if (!gotProfile) {
        throw new Error(
          "The run hit the server time limit before finishing — please try again.",
        );
      }
      setPhase("done");
      setThought("");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-6 pb-24 pt-14 sm:pt-20">
        {/* Masthead */}
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ticker">
            ▮ Deal-sourcing intelligence · live agent
          </p>
          <h1 className="mt-5 font-serif text-[2.6rem] font-medium leading-[1.08] text-bright sm:text-5xl">
            Every company has a story.
            <br />
            <em className="text-ticker">Send the agent</em> to find it.
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted">
            DealScout is an autonomous researcher: it searches the web, reads
            sources, and files a structured dossier — funding, deal signals,
            confidence — while you watch it work.
          </p>
        </header>

        {/* Command bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(company);
          }}
          className="mt-10"
        >
          <label htmlFor="company" className="sr-only">
            Company name
          </label>
          <div className="flex items-center gap-3 border border-line bg-panel px-4 py-3 font-mono text-sm focus-within:border-ticker">
            <span aria-hidden className="select-none text-ticker">
              &gt;
            </span>
            <input
              id="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="research a company…"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-bright placeholder-muted/60 outline-none"
            />
            <button
              type="submit"
              disabled={phase === "running" || !company.trim()}
              className="shrink-0 bg-ticker px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-ink transition hover:bg-[#f7bd63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ticker disabled:cursor-not-allowed disabled:opacity-35"
            >
              {phase === "running" ? "Working…" : "Run"}
            </button>
          </div>
        </form>

        {/* Example targets (empty state) */}
        {phase === "idle" && (
          <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
            <a
              href="/batch"
              className="border border-line px-2.5 py-1 text-ticker/80 transition hover:border-ticker hover:text-ticker"
            >
              batch mode →
            </a>
            <span className="ml-2 mr-1">try:</span>
            {EXAMPLES.map((name) => (
              <button
                key={name}
                onClick={() => run(name)}
                className="border border-line px-2.5 py-1 text-muted transition hover:border-ticker hover:text-ticker focus-visible:outline focus-visible:outline-2 focus-visible:outline-ticker"
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* Agent log */}
        {log.length > 0 && (
          <section className="mt-10 border border-line bg-panel" aria-live="polite">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
                Agent log
              </h2>
              <span className="font-mono text-[11px] text-muted">
                {phase === "running" ? elapsed(startRef.current) : "closed"}
              </span>
            </div>
            <ol className="px-4 py-3 font-mono text-[13px] leading-6">
              {log.map((line, i) => {
                const active = phase === "running" && i === log.length - 1;
                return (
                  <li key={i} className={active ? "text-ticker" : "text-muted"}>
                    <span className="mr-3 opacity-50">{line.at}</span>
                    {line.text}
                    {active && <span className="caret-blink ml-1">▍</span>}
                  </li>
                );
              })}
            </ol>
            {thought && (
              <p className="border-t border-line px-4 py-2 font-serif text-sm italic text-muted/80">
                …{thought}
              </p>
            )}
          </section>
        )}

        {/* Analyst notes (streamed narration) */}
        {narrative && (
          <section className="mt-6">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
              Notes from the field
            </h2>
            <p className="mt-2 whitespace-pre-wrap border-l-2 border-line pl-4 text-[15px] leading-relaxed text-bright/80">
              {narrative}
            </p>
          </section>
        )}

        {/* The dossier */}
        {profile && (
          <article className="dossier-enter mt-10 bg-paper text-paper-ink shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            <div className="border-b border-paper-line px-6 py-5 sm:px-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-paper-muted">
                    DealScout · Field dossier
                  </p>
                  <h2 className="mt-2 font-serif text-3xl font-semibold leading-tight">
                    {profile.company_name}
                  </h2>
                </div>
                <span
                  className={`mt-1 shrink-0 -rotate-3 border-2 px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.2em] ${
                    profile.confidence === "high"
                      ? "border-emerald-800/60 text-emerald-900"
                      : profile.confidence === "medium"
                        ? "border-amber-800/60 text-amber-900"
                        : "border-rose-800/60 text-rose-900"
                  }`}
                >
                  {profile.confidence} confidence
                </span>
              </div>
              <p className="mt-4 font-serif text-[17px] italic leading-relaxed">
                {profile.summary}
              </p>
            </div>

            <dl className="grid grid-cols-1 gap-x-10 gap-y-4 px-6 py-6 sm:grid-cols-2 sm:px-8">
              <Field label="Website" value={profile.website} />
              <Field label="Industry" value={profile.industry} />
              <Field label="Headquarters" value={profile.hq_location} />
              <Field label="Founded" value={profile.founded_year} />
              <Field label="Employees" value={profile.employee_count} />
              <Field label="Funding" value={profile.funding_status} />
              <Field label="Business model" value={profile.business_model} wide />
              <ListField label="Products & services" items={profile.products_services} />
              <ListField label="Recent news" items={profile.recent_news} />
              <ListField label="Deal signals" items={profile.deal_signals} signal />
            </dl>

            <p className="border-t border-paper-line px-6 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-paper-muted sm:px-8">
              Compiled by an autonomous agent · verify before use ·{" "}
              {new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </article>
        )}

        {error && (
          <p
            role="alert"
            className="mt-8 border border-rose-900/60 bg-rose-950/40 px-4 py-3 font-mono text-sm text-rose-300"
          >
            {error}
          </p>
        )}

        <footer className="mt-20 flex items-center justify-between border-t border-line pt-5 font-mono text-[11px] text-muted">
          <span>Next.js · Claude API · server-side web search</span>
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

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`border-b border-dotted border-paper-line pb-2 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-muted">{label}</dt>
      <dd className="mt-1 text-[14px] leading-snug">{value || "unknown"}</dd>
    </div>
  );
}

function ListField({
  label,
  items,
  signal,
}: {
  label: string;
  items: string[];
  signal?: boolean;
}) {
  return (
    <div className="border-b border-dotted border-paper-line pb-2 sm:col-span-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-muted">{label}</dt>
      <dd className="mt-1.5">
        {items.length === 0 ? (
          <span className="text-[14px] text-paper-muted">unknown</span>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item, i) => (
              <li key={i} className="flex gap-2 text-[14px] leading-snug">
                <span
                  aria-hidden
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 ${signal ? "bg-ticker" : "bg-paper-line"}`}
                />
                {item}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
