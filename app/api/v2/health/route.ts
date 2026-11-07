import { agentFetch } from "@/lib/agent-service";

export const runtime = "nodejs";

// Whether this deployment can reach the v2 agent service.
export async function GET() {
  try {
    const res = await agentFetch("health");
    return Response.json({ agent: await res.json() }, { status: res.ok ? 200 : 502 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
