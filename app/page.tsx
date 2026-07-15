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
  // Mirror of startRef for render-time reads (reading a ref during render
  // violates React's rules; the handlers keep the ref to avoid stale closures).
  const [startAt, setStartAt] = useState(0);

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
    setStartAt(startRef.current);

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
    <main className="flex-1">
      {/* Command deck */}
      <section className="dot-grid bg-navy">
        <div className="mx-auto w-full max-w-3xl px-6 pb-12 pt-12 sm:pb-14 sm:pt-16">
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-[2.75rem]">
            Company research,
            <br />
            run by an agent.
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/70">
            Type a name. DealScout searches the web, reads the sources it
            finds, and files a deal-ready profile — funding, business model,
            signals — while you watch.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(company);
            }}
            className="mt-7"
          >
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
                className="h-11 min-w-0 flex-1 rounded-md border border-white/20 bg-white px-3.5 text-[15px] text-ink outline-none transition placeholder:text-soft/70 focus:border-mint focus:ring-2 focus:ring-mint/30"
              />
              <button
                type="submit"
                disabled={phase === "running" || !company.trim()}
                className="h-11 shrink-0 rounded-md bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint disabled:cursor-not-allowed disabled:opacity-50"
              >
                {phase === "running" ? "Researching…" : "Research"}
              </button>
            </div>
          </form>

          {phase === "idle" && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-white/60">
              <span className="mr-1">Try</span>
              {EXAMPLES.map((name) => (
                <button
                  key={name}
                  onClick={() => run(name)}
                  className="rounded-full border border-white/20 px-3 py-1 text-white/80 transition hover:border-mint hover:text-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto w-full max-w-3xl px-6 pb-20">
        {/* Sample report (empty state) — real output from a live run */}
        {phase === "idle" && (
          <section className="-mt-0 pt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-medium text-soft">
                What you get back
              </h2>
              <span className="text-xs text-soft/70">
                Sample from a live run, Jul 2026
              </span>
            </div>
            <div className="mt-2 rounded-lg border border-edge bg-surface shadow-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge px-6 py-4">
                <h3 className="font-display text-lg font-semibold tracking-tight text-ink">
                  Ramp
                </h3>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                  High confidence
                </span>
                <button
                  onClick={() => run("Ramp")}
                  className="ml-auto text-[13px] font-medium text-accent transition hover:text-accent-hover"
                >
                  Run it fresh →
                </button>
              </div>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 px-6 py-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs font-medium text-soft">Industry</dt>
                  <dd className="mt-0.5 text-[13px] text-ink">
                    FinTech — corporate spend
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-soft">HQ</dt>
                  <dd className="mt-0.5 text-[13px] text-ink">New York, NY</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-soft">Founded</dt>
                  <dd className="mt-0.5 text-[13px] text-ink">2019</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-soft">Valuation</dt>
                  <dd className="mt-0.5 text-[13px] text-ink">
                    $32B (Nov 2025)
                  </dd>
                </div>
              </dl>
              <div className="border-t border-edge px-6 py-4">
                <h4 className="text-xs font-medium text-soft">Deal signals</h4>
                <ul className="mt-1.5 space-y-1">
                  {[
                    "Four funding rounds in 2025 totaling $1B+",
                    "Annualized revenue ~$1.2B, up 133% YoY",
                    "Employee tender offers — a classic pre-IPO signal",
                  ].map((item) => (
                    <li
                      key={item}
                      className="flex gap-2 text-[13px] leading-snug text-ink"
                    >
                      <span
                        aria-hidden
                        className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* Live agent workspace */}
        {log.length > 0 && (
          <section
            className="mt-8 overflow-hidden rounded-lg bg-navy"
            aria-live="polite"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <h2 className="flex items-center gap-2 text-[13px] font-medium text-white/80">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${phase === "running" ? "pulse-dot bg-mint" : "bg-white/30"}`}
                />
                Agent activity
              </h2>
              {phase === "running" && (
                <span className="font-mono text-xs text-white/50">
                  {elapsed(startAt)}
                </span>
              )}
            </div>
            <ol className="px-4 py-3 font-mono text-[13px] leading-6">
              {log.map((line, i) => {
                const active = phase === "running" && i === log.length - 1;
                return (
                  <li
                    key={i}
                    className={`flex gap-3 ${active ? "text-mint" : "text-white/60"}`}
                  >
                    <span className="shrink-0 text-xs leading-6 text-white/35">
                      {line.at}
                    </span>
                    <span>{line.text}</span>
                  </li>
                );
              })}
            </ol>
            {thought && (
              <p className="border-t border-white/10 px-4 py-2 text-[13px] text-white/45">
                …{thought}
              </p>
            )}
          </section>
        )}

        {/* Streamed narration — collapses once the profile is in */}
        {narrative && (
          <details className="mt-6" open={!profile}>
            <summary className="cursor-pointer select-none text-[13px] font-medium text-soft transition hover:text-ink">
              Research notes
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-soft">
              {narrative}
            </p>
          </details>
        )}

        {/* Company profile */}
        {profile && (
          <article className="card-enter mt-8 overflow-hidden rounded-lg border border-edge bg-surface shadow-sm">
            <div className="border-b border-edge px-6 py-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
                  {profile.company_name}
                </h2>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    profile.confidence === "high"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : profile.confidence === "medium"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-red-200 bg-red-50 text-red-700"
                  }`}
                >
                  {profile.confidence[0].toUpperCase() +
                    profile.confidence.slice(1)}{" "}
                  confidence
                </span>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-ink/90">
                {profile.summary}
              </p>
            </div>

            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 px-6 py-5 sm:grid-cols-2">
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

            <p className="border-t border-edge bg-canvas/60 px-6 py-3 text-xs text-soft">
              Compiled from public web sources on{" "}
              {new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
              . Verify before use.
            </p>
          </article>
        )}

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-medium text-soft">{label}</dt>
      <dd className="mt-0.5 text-[14px] leading-snug text-ink">
        {value || "Unknown"}
      </dd>
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
    <div className="sm:col-span-2">
      <dt className="text-xs font-medium text-soft">{label}</dt>
      <dd className="mt-1">
        {items.length === 0 ? (
          <span className="text-[14px] text-soft">Unknown</span>
        ) : (
          <ul className="space-y-1">
            {items.map((item, i) => (
              <li key={i} className="flex gap-2 text-[14px] leading-snug text-ink">
                <span
                  aria-hidden
                  className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${signal ? "bg-accent" : "bg-edge-strong"}`}
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
