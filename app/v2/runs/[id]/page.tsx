"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BRANCH_LABELS, FIELD_LABELS, StatusBadge, safeHref, sourceLabel, timeAgo, usd } from "@/app/v2/ui";
import {
  ApiError,
  LIST_FIELDS,
  TEXT_FIELDS,
  branchProgress,
  decideRun,
  fromForm,
  getRun,
  isActive,
  readAdminToken,
  resumeRun,
  saveAdminToken,
  starts,
  toForm,
  type Change,
  type Decision,
  type ProfileForm,
  type RunView,
  type V2Profile,
} from "@/lib/v2-client";

const POLL_MS = 1500;

// What the graph is doing, from the node it will run next (the one running).
const NEXT_STEP: Record<string, string> = {
  load_memory: "Loading what was saved before",
  planner: "Planning",
  researcher: "Researching",
  verifier: "Verifying claims",
  writer: "Writing the profile",
  approve: "Waiting for your approval",
  save: "Saving",
};

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunView | null>(null);
  const [now, setNow] = useState(0);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(false);
  // A decision this deployment refused for want of the admin token, to send
  // again once it's entered.
  const [refused, setRefused] = useState<Decision | null>(null);
  // Bumped to start polling again after a resume.
  const [pollRound, setPollRound] = useState(0);
  const startFailed = useRef(false);

  // A start launched from this tab: it answers with the run once it reaches
  // the approval step, or with the reason there is no run (a 429, say).
  useEffect(() => {
    const started = starts.get(id);
    if (!started) return;
    let live = true;
    started
      // The start request answers last: polling or a decision may already
      // have shown a newer state of the run.
      .then((r) => live && setRun((shown) => (shown && shown.updated_at > r.updated_at ? shown : r)))
      .catch((err: Error) => {
        startFailed.current = true;
        if (live) setError(err.message);
      });
    return () => {
      live = false;
    };
  }, [id]);

  // Follow the checkpoints while a request drives the graph.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let misses = 0;
    async function poll() {
      try {
        const r = await getRun(id);
        if (stopped) return;
        setRun(r);
        setNow(Date.now());
        // The run's own state now tells the story (an error from a start
        // request the agent dropped, say, is stale).
        setError("");
        if (!isActive(r)) return;
      } catch (err) {
        if (stopped) return;
        if (!(err instanceof ApiError && err.status === 404)) {
          setError((err as Error).message);
        } else if (startFailed.current) {
          return;
        } else if (!starts.has(id) && ++misses >= 3) {
          // Not started from this tab and not in the database.
          setMissing(true);
          return;
        }
      }
      timer = setTimeout(poll, POLL_MS);
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, pollRound]);

  async function decide(decision: Decision) {
    setBusy(decision.action);
    setError("");
    setRefused(null);
    try {
      setRun(await decideRun(id, decision, readAdminToken()));
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        saveAdminToken("");
        setRefused(decision);
      }
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function resume() {
    setBusy("resume");
    setError("");
    let settled = false;
    const resumed = resumeRun(id).finally(() => {
      settled = true;
    });
    // The resume request claims the run right away and then runs the graph;
    // poll meanwhile, as for a start. Not after a quick refusal (a 429, say):
    // a poll would clear its message.
    setTimeout(() => !settled && setPollRound((n) => n + 1), 800);
    try {
      setRun(await resumed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (missing) {
    return (
      <Shell>
        <p className="mt-10 text-[15px] text-soft">
          No run with this id. <Link href="/v2" className="text-accent hover:text-accent-hover">Start one</Link>.
        </p>
      </Shell>
    );
  }

  if (!run) {
    return (
      <Shell>
        {error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : (
          <p className="mt-10 flex items-center gap-2 text-[15px] text-soft">
            <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> Starting…
          </p>
        )}
      </Shell>
    );
  }

  const active = isActive(run);
  const cutOff = run.status === "running" && run.resumable;
  const step = run.next[0] ? NEXT_STEP[run.next[0]] : null;

  return (
    <Shell>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-10">
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink">{run.company}</h1>
        <StatusBadge status={run.status} resumable={run.resumable} />
        <span className="ml-auto font-mono text-xs text-soft">
          {usd(run.usage.cost_usd)} · started {timeAgo(run.created_at, now || Date.parse(run.updated_at))}
        </span>
      </header>
      {run.previous_version && (
        <p className="mt-1 text-[13px] text-soft">
          Researched before: this run started from saved version {run.previous_version}.
        </p>
      )}

      {cutOff && (
        <Notice tone="red">
          This run was cut off: the request driving it ended before the run finished. Resume continues from the
          last finished step; researchers that had finished aren&apos;t run again.
          <ResumeButton busy={busy} onClick={resume} />
        </Notice>
      )}
      {run.status === "failed" && (
        <Notice tone="red">
          The run failed: <span className="font-mono text-[12px]">{run.error}</span>. Resume retries from the last
          finished step.
          <ResumeButton busy={busy} onClick={resume} />
        </Notice>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {refused && (
        <TokenForm
          onSubmit={(token) => {
            saveAdminToken(token);
            decide(refused);
          }}
        />
      )}

      <Progress run={run} active={active} step={step} />

      {run.draft && (
        <Draft
          run={run}
          draft={run.edited ?? run.draft}
          editing={editing}
          busy={busy}
          onDecide={decide}
          onEdit={() => setEditing(true)}
          onCancel={() => setEditing(false)}
        />
      )}

      {run.status === "saved" && (
        <Notice tone="green">
          Saved as version {run.saved_version}. The next run for {run.company} starts from it.
        </Notice>
      )}
      {run.status === "rejected" && <Notice tone="grey">Rejected. Nothing was saved.</Notice>}

      <Usage run={run} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-3xl px-6 pb-20">
        <Link href="/v2" className="mt-6 inline-block text-[13px] text-soft transition hover:text-ink">
          ← Your runs
        </Link>
        {children}
      </div>
    </main>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {children}
    </p>
  );
}

function Notice({ tone, children }: { tone: "red" | "green" | "grey"; children: React.ReactNode }) {
  const style = {
    red: "border-red-200 bg-red-50 text-red-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    grey: "border-edge bg-surface text-soft",
  }[tone];
  return <div className={`mt-6 rounded-md border px-4 py-3 text-sm leading-relaxed ${style}`}>{children}</div>;
}

function TokenForm({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) onSubmit(token.trim());
      }}
    >
      <label htmlFor="admin-token" className="text-sm text-soft">
        Admin token
      </label>
      <input
        id="admin-token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-edge bg-surface px-3 py-1.5 font-mono text-sm text-ink"
      />
      <button
        type="submit"
        className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
      >
        Send again
      </button>
    </form>
  );
}

function ResumeButton({ busy, onClick }: { busy: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy !== ""}
      className="mt-2 block rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-50"
    >
      {busy === "resume" ? "Resuming…" : "Resume"}
    </button>
  );
}

function Progress({ run, active, step }: { run: RunView; active: boolean; step: string | null }) {
  const branches = branchProgress(run);
  return (
    <section className="mt-6 overflow-hidden rounded-lg bg-navy" aria-live="polite">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-[13px] font-medium text-white/80">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${active ? "pulse-dot bg-mint" : "bg-white/30"}`} />
        {active ? (step ?? "Running") : run.status === "awaiting_approval" ? "Waiting for your approval" : "Agent run"}
      </div>
      <ol className="space-y-2 px-4 py-3 font-mono text-[13px] leading-6 text-white/70">
        <li>
          <span className="text-white/40">plan </span>
          {run.plan.length ? run.plan.map((b) => BRANCH_LABELS[b]).join(", ") : "…"}
        </li>
        {branches.map(({ branch, passes }) => (
          <li key={branch}>
            <span className="text-white/90">{BRANCH_LABELS[branch]}</span>
            {passes.map((p) => (
              <div key={p.attempt} className="pl-4">
                <span className="text-white/40">{p.attempt > 1 ? "retry " : "pass 1 "}</span>
                {p.step === "researching" && (
                  <span className={active ? "text-mint" : ""}>{active ? "researching…" : "not finished"}</span>
                )}
                {p.step === "verifying" && <span className="text-mint">verifying {p.claims} claims…</span>}
                {p.step === "done" && (
                  <span>
                    {p.supported} of {p.claims} claims verified
                  </span>
                )}
                {p.toolErrors.length > 0 && (
                  <span className="text-amber-300"> · {p.toolErrors.length} web tool errors</span>
                )}
                {p.rejected.length > 0 && <Rejections rejected={p.rejected} />}
              </div>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Rejections({ rejected }: { rejected: RunView["verdicts"][number]["rejected"] }) {
  return (
    <details className="pl-4 font-sans text-[12px]">
      <summary className="cursor-pointer select-none text-white/50 hover:text-white/80">
        {rejected.length} rejected
      </summary>
      <ul className="mt-1 space-y-1.5 pb-1">
        {rejected.map((r, i) => (
          <li key={i} className="text-white/60">
            <span className="text-white/40">{FIELD_LABELS[r.field] ?? r.field}: </span>
            {r.value}
            <span className="block text-amber-200/80">
              {r.check === "source" ? "source check" : "quote check"}: {r.reason ?? "unsupported"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Draft(props: {
  run: RunView;
  draft: V2Profile;
  editing: boolean;
  busy: string;
  onDecide: (d: Decision) => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const { run, draft, editing, busy } = props;
  const waiting = run.status === "awaiting_approval";
  const carried = new Set(draft.carried_over ?? []);
  return (
    <article className="card-enter mt-8 overflow-hidden rounded-lg border border-edge bg-surface shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge px-6 py-4">
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
          {waiting ? "Draft profile" : run.edited ? "Profile, as edited" : "Profile"}
        </h2>
        <span className="text-xs text-soft">{draft.confidence} confidence</span>
        {waiting && !editing && (
          <div className="ml-auto flex gap-2">
            <ActionButton primary disabled={busy !== ""} onClick={() => props.onDecide({ action: "approve" })}>
              {busy === "approve" ? "Saving…" : "Approve"}
            </ActionButton>
            <ActionButton disabled={busy !== ""} onClick={props.onEdit}>
              Edit
            </ActionButton>
            <ActionButton disabled={busy !== ""} onClick={() => props.onDecide({ action: "reject" })}>
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </ActionButton>
          </div>
        )}
      </div>

      {editing ? (
        <EditForm draft={draft} busy={busy} onSave={props.onDecide} onCancel={props.onCancel} />
      ) : (
        <>
          {draft.summary !== "unknown" && (
            <p className="px-6 pt-4 text-[15px] leading-relaxed text-ink/90">{draft.summary}</p>
          )}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 px-6 py-5 sm:grid-cols-2">
            {TEXT_FIELDS.filter((f) => !["company_name", "summary"].includes(f)).map((f) => (
              <Field key={f} name={f} draft={draft} carried={carried.has(f)} version={run.previous_version} />
            ))}
            {LIST_FIELDS.map((f) => (
              <Field key={f} name={f} draft={draft} carried={carried.has(f)} version={run.previous_version} />
            ))}
          </dl>
        </>
      )}

      {run.changes && <Changes changes={run.changes} version={run.previous_version} />}
    </article>
  );
}

function ActionButton(props: {
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        props.primary
          ? "bg-accent text-white hover:bg-accent-hover"
          : "border border-edge-strong bg-surface text-ink hover:bg-canvas"
      }`}
    >
      {props.children}
    </button>
  );
}

function Field(props: { name: string; draft: V2Profile; carried: boolean; version: number | null }) {
  const value = props.draft[props.name as keyof V2Profile] as string | string[];
  const list = Array.isArray(value);
  const sources = props.draft.sources?.[props.name] ?? [];
  const wide = list || props.name === "business_model" || props.name === "funding_status";
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="flex items-center gap-2 text-xs font-medium text-soft">
        {FIELD_LABELS[props.name]}
        {props.carried && (
          <span className="rounded border border-edge px-1.5 text-[11px] font-normal text-soft">
            kept from v{props.version}
          </span>
        )}
      </dt>
      <dd className="mt-0.5 text-[14px] leading-snug text-ink">
        {list ? (
          value.length === 0 ? (
            <span className="text-soft">Unknown</span>
          ) : (
            <ul className="space-y-1">
              {value.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-edge-strong" />
                  {item}
                </li>
              ))}
            </ul>
          )
        ) : value === "unknown" ? (
          <span className="text-soft">Unknown</span>
        ) : (
          value
        )}
      </dd>
      {sources.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-soft">
          {sources.map((url) => {
            const href = safeHref(url);
            return href ? (
              <a key={url} href={href} target="_blank" rel="noreferrer nofollow" className="underline-offset-2 hover:underline">
                {sourceLabel(url, sources)}
              </a>
            ) : (
              <span key={url}>{url}</span>
            );
          })}
        </p>
      )}
    </div>
  );
}

function show(value: string | string[]): string {
  return Array.isArray(value) ? (value.length ? value.join("; ") : "none") : value;
}

function Changes({ changes, version }: { changes: Change[]; version: number | null }) {
  return (
    <section className="border-t border-edge bg-canvas/60 px-6 py-4">
      <h3 className="text-xs font-medium text-soft">
        {changes.length ? `What changed since version ${version}` : `No changes since version ${version}`}
      </h3>
      {changes.length > 0 && (
        <ul className="mt-2 space-y-2 text-[13px] leading-snug">
          {changes.map((c) => (
            <li key={c.field}>
              <span className="font-medium text-ink">{FIELD_LABELS[c.field] ?? c.field}</span>
              <span className="block text-soft line-through decoration-red-300">{show(c.before)}</span>
              <span className="block text-ink">{show(c.after)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EditForm(props: {
  draft: V2Profile;
  busy: string;
  onSave: (d: Decision) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ProfileForm>(() => toForm(props.draft));
  const set = (name: keyof ProfileForm, value: string) => setForm((f) => ({ ...f, [name]: value }));
  const input =
    "mt-1 w-full rounded-md border border-edge-strong bg-surface px-3 py-1.5 text-[14px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <form
      className="grid grid-cols-1 gap-4 px-6 py-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave({ action: "edit", profile: fromForm(form, props.draft) });
      }}
    >
      {TEXT_FIELDS.map((f) => (
        <label key={f} className={`text-xs font-medium text-soft ${f === "summary" || f === "business_model" ? "sm:col-span-2" : ""}`}>
          {FIELD_LABELS[f]}
          {f === "summary" ? (
            <textarea rows={3} value={form[f]} onChange={(e) => set(f, e.target.value)} className={input} />
          ) : (
            <input value={form[f]} onChange={(e) => set(f, e.target.value)} className={input} />
          )}
        </label>
      ))}
      <label className="text-xs font-medium text-soft">
        Confidence
        <select value={form.confidence} onChange={(e) => set("confidence", e.target.value)} className={input}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </label>
      {LIST_FIELDS.map((f) => (
        <label key={f} className="text-xs font-medium text-soft sm:col-span-2">
          {FIELD_LABELS[f]} <span className="font-normal">(one per line)</span>
          <textarea rows={4} value={form[f]} onChange={(e) => set(f, e.target.value)} className={input} />
        </label>
      ))}
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={props.busy !== ""}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-50"
        >
          {props.busy === "edit" ? "Saving…" : "Save edited profile"}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-md border border-edge-strong px-4 py-1.5 text-sm font-semibold text-ink transition hover:bg-canvas"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Usage({ run }: { run: RunView }) {
  const u = run.usage;
  const saved =
    u.cost_usd !== null && u.uncached_cost_usd ? Math.round(100 * (1 - u.cost_usd / u.uncached_cost_usd)) : null;
  return (
    <details className="mt-6 rounded-lg border border-edge bg-surface px-5 py-3 text-[13px]">
      <summary className="cursor-pointer select-none text-soft">
        Cost {usd(u.cost_usd)} of a {usd(run.budget_usd)} budget · {u.requests} model requests ·{" "}
        {u.web_search_requests} searches{saved !== null && saved > 0 ? ` · caching saved ${saved}%` : ""}
      </summary>
      <table className="mt-3 w-full font-mono text-[12px]">
        <thead className="text-left text-soft">
          <tr>
            <th className="py-1 font-normal">step</th>
            <th className="font-normal">model</th>
            <th className="text-right font-normal">searches</th>
            <th className="text-right font-normal">cost</th>
            <th className="text-right font-normal">time</th>
          </tr>
        </thead>
        <tbody className="text-ink">
          {u.calls.map((c, i) => (
            <tr key={i} className="border-t border-edge">
              <td className="py-1">
                {c.node}
                {c.branch ? ` · ${c.branch}${c.attempt && c.attempt > 1 ? " (retry)" : ""}` : ""}
              </td>
              <td>{c.model}</td>
              <td className="text-right">{c.web_search_requests}</td>
              <td className="text-right">{usd(c.cost_usd)}</td>
              <td className="text-right">{c.seconds}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
