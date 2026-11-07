// Client for the v2 agent: the Python LangGraph service in agent/.
//
// On Vercel the agent is a private service in the same deployment, reached
// through the binding in vercel.json, which sets AGENT_URL. Locally, set
// AGENT_URL to wherever `uvicorn app.main:app` runs.

/** Calls the agent at `path` (no leading slash), or throws if AGENT_URL is unset. */
export async function agentFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = process.env.AGENT_URL;
  if (!base) throw new Error("AGENT_URL is not set");
  // new URL("runs", "https://x/agent") would drop "agent"; a trailing slash keeps it.
  return fetch(new URL(path, base.endsWith("/") ? base : `${base}/`), { cache: "no-store", ...init });
}
