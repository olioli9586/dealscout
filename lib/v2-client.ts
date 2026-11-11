// Browser side of v2: the run view the agent returns (agent/app/runs.py
// view()), calls to /api/v2, the run history kept in localStorage, and the
// per-branch progress the run page shows while the graph runs.

import type { CompanyProfile } from "@/lib/agent";

export type Branch = "business" | "funding" | "leadership" | "news";
export type RunStatus = "running" | "awaiting_approval" | "saved" | "rejected" | "failed";

/** v1's profile plus leadership, the sources per field, and what memory kept. */
export interface V2Profile extends CompanyProfile {
  leadership: string[];
  sources?: Record<string, string[]>;
  carried_over?: string[];
}

export interface Rejected {
  field: string;
  value: string;
  source_url: string;
  check: "source" | "quote";
  reason: string | null;
}

export interface Change {
  field: string;
  before: string | string[];
  after: string | string[];
}

export interface UsageCall {
  node: string;
  branch: Branch | null;
  attempt: number | null;
  model: string;
  requests: number;
  web_search_requests: number;
  cost_usd: number | null;
  seconds: number;
}

export interface RunView {
  id: string;
  company: string;
  status: RunStatus;
  resumable: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
  next: string[];
  plan: Branch[];
  findings: { branch: Branch; attempt: number; claims: number; tool_errors: string[] }[];
  verdicts: { branch: Branch; attempt: number; supported: number; unsupported: number; rejected: Rejected[] }[];
  draft: V2Profile | null;
  previous_version: number | null;
  changes: Change[] | null;
  saved_version: number | null;
  budget_usd: number | null;
  usage: {
    requests: number;
    web_search_requests: number;
    cost_usd: number | null;
    uncached_cost_usd: number | null;
    calls: UsageCall[];
  };
}

export interface RunSummary {
  id: string;
  company: string;
  status: RunStatus;
  resumable: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
  cost_usd: number | null;
}

export type Decision = { action: "approve" } | { action: "reject" } | { action: "edit"; profile: V2Profile };

/** An API error with the HTTP status, so callers can tell a 429 from a 409. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** Runs the graph up to the approval step; resolves when it gets there (or fails). */
export const startRun = (company: string, id: string) => call<RunView>("/api/v2/runs", post({ company, id }));
export const getRun = (id: string) => call<RunView>(`/api/v2/runs/${id}`);
export const resumeRun = (id: string) => call<RunView>(`/api/v2/runs/${id}/resume`, post({}));
/** adminToken: for a deployment that restricts decisions (V2_ADMIN_TOKEN). */
export const decideRun = (id: string, decision: Decision, adminToken = "") =>
  call<RunView>(
    `/api/v2/runs/${id}/decision`,
    post(decision, adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
  );

// The admin token, for this tab only. Storage can be unavailable (private
// mode, blocked site data); then the page asks again next time.
const ADMIN_TOKEN_KEY = "dealscout-v2-admin-token";

export function readAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAdminToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // Not kept: the page asks again next time.
  }
}
export const listRuns = (ids: string[]) =>
  ids.length ? call<RunSummary[]>(`/api/v2/runs?ids=${ids.join(",")}`) : Promise.resolve([]);

/**
 * Starts launched from this tab, by run id. The start request holds the
 * graph's whole run (up to the approval step), so the page that launched it
 * moves on to the run page at once; the run page finds the request here to
 * show its error (a 429, say) instead of waiting for a run that never began.
 */
export const starts = new Map<string, Promise<RunView>>();

/** Starts a run under a new id, remembers it, and returns the id at once. */
export function launch(company: string, storage: Pick<Storage, "getItem" | "setItem">): string {
  const id = crypto.randomUUID();
  remember(storage, id);
  const started = startRun(company, id);
  // The run page attaches its own handlers; this only keeps an early
  // failure from being reported as unhandled before it does.
  started.catch(() => {});
  starts.set(id, started);
  return id;
}

// --- history ----------------------------------------------------------------

export const HISTORY_KEY = "dealscout-v2-history";
export const HISTORY_MAX = 100;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The run ids this browser started, newest first. Anything malformed is dropped. */
export function readHistory(storage: Pick<Storage, "getItem">): string[] {
  try {
    const ids: unknown = JSON.parse(storage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && RUN_ID.test(id)) : [];
  } catch {
    return [];
  }
}

/** Puts a run id first in the history, keeping the newest HISTORY_MAX. */
export function remember(storage: Pick<Storage, "getItem" | "setItem">, id: string): void {
  const ids = [id, ...readHistory(storage).filter((x) => x !== id)].slice(0, HISTORY_MAX);
  storage.setItem(HISTORY_KEY, JSON.stringify(ids));
}

// --- progress ---------------------------------------------------------------

export type Step = "researching" | "verifying" | "done";

export interface BranchProgress {
  branch: Branch;
  // One entry per research pass so far (a retry adds a second).
  passes: {
    attempt: number;
    step: Step;
    claims: number | null;
    supported: number | null;
    rejected: Rejected[];
    toolErrors: string[];
  }[];
}

/**
 * Where each planned branch is, from the checkpointed state: a pass with
 * no finding yet is researching, one with a finding but no verdict is being
 * verified. A retry pass appears once its finding is in (the view doesn't
 * say which branches the verifier sent back until then).
 */
export function branchProgress(run: RunView): BranchProgress[] {
  return run.plan.map((branch) => {
    const findings = run.findings.filter((f) => f.branch === branch);
    const verdicts = run.verdicts.filter((v) => v.branch === branch);
    const attempts = Math.max(1, ...findings.map((f) => f.attempt));
    const passes: BranchProgress["passes"] = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const finding = findings.find((f) => f.attempt === attempt);
      const verdict = verdicts.find((v) => v.attempt === attempt);
      passes.push({
        attempt,
        step: verdict ? "done" : finding ? "verifying" : "researching",
        claims: finding?.claims ?? null,
        supported: verdict?.supported ?? null,
        rejected: verdict?.rejected ?? [],
        toolErrors: finding?.tool_errors ?? [],
      });
    }
    return { branch, passes };
  });
}

/** True while a request is (or should be) driving the graph. */
export const isActive = (run: RunView) => run.status === "running" && !run.resumable;

// --- editing ------------------------------------------------------------------

export const LIST_FIELDS = ["products_services", "leadership", "recent_news", "deal_signals"] as const;
export const TEXT_FIELDS = [
  "company_name",
  "website",
  "industry",
  "hq_location",
  "founded_year",
  "employee_count",
  "funding_status",
  "business_model",
  "summary",
] as const;

export type ProfileForm = Record<(typeof TEXT_FIELDS)[number] | (typeof LIST_FIELDS)[number], string> & {
  confidence: V2Profile["confidence"];
};

/** A profile as form values: list fields become one item per line. */
export function toForm(p: V2Profile): ProfileForm {
  const form = { confidence: p.confidence } as ProfileForm;
  for (const f of TEXT_FIELDS) form[f] = p[f];
  for (const f of LIST_FIELDS) form[f] = (p[f] ?? []).join("\n");
  return form;
}

/**
 * The edited profile to send. Blank lines are dropped from list fields. A
 * field keeps the draft's sources only if the edit left it as it was: the
 * pages behind the old value don't back a new one. carried_over is left
 * out: after an edit, the person, not memory, stands behind every field.
 */
export function fromForm(form: ProfileForm, draft: V2Profile): V2Profile {
  const profile = { confidence: form.confidence } as V2Profile;
  for (const f of TEXT_FIELDS) profile[f] = form[f].trim() || "unknown";
  for (const f of LIST_FIELDS) {
    profile[f] = form[f]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const unchanged = (f: string) =>
    JSON.stringify(profile[f as keyof V2Profile]) === JSON.stringify(draft[f as keyof V2Profile]);
  profile.sources = Object.fromEntries(Object.entries(draft.sources ?? {}).filter(([f]) => unchanged(f)));
  return profile;
}
