// Client for the v2 agent: the Python LangGraph service in agent/.
//
// On Vercel the agent is a private service in the same deployment, reached
// through the binding in vercel.json, which sets AGENT_URL. Locally, set
// AGENT_URL to wherever `uvicorn app.main:app` runs.

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run ids are UUIDs; checking before forwarding keeps "../" out of agent paths. */
export function isRunId(id: string): boolean {
  return RUN_ID.test(id);
}

/** Calls the agent at `path` (no leading slash), or throws if AGENT_URL is unset. */
export async function agentFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = process.env.AGENT_URL;
  if (!base) throw new Error("AGENT_URL is not set");
  // new URL("runs", "https://x/agent") would drop "agent"; a trailing slash keeps it.
  return fetch(new URL(path, base.endsWith("/") ? base : `${base}/`), { cache: "no-store", ...init });
}

/**
 * Calls the agent and passes its answer on with the same status. FastAPI
 * reports errors as {"detail": ...}; they become {"error": "..."}, the shape
 * the v1 routes use.
 */
export async function forwardToAgent(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await agentFetch(path, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `The agent is unreachable: ${message}` }, { status: 503 });
  }
  const body = await res.json().catch(() => null);
  if (res.ok) return Response.json(body, { status: res.status });
  return Response.json({ error: errorMessage(body?.detail, res.status) }, { status: res.status });
}

function errorMessage(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  // A validation error (422) lists one entry per problem.
  if (Array.isArray(detail) && detail.every((d) => typeof d?.msg === "string")) {
    return detail.map((d) => d.msg).join("; ");
  }
  return `The agent failed (HTTP ${status}).`;
}

/** JSON request options for a POST to the agent. */
export function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
