import { forwardToAgent, isRunId, postJson } from "@/lib/agent-service";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

// Continues a run that failed or was cut off, from its last checkpoint. It
// spends like a start, so it takes from the same per-IP daily quota.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRunId(id)) return Response.json({ error: "No such run." }, { status: 404 });
  if (!checkRateLimit(clientIp(req)).allowed) {
    return Response.json({ error: "Daily demo limit reached for your IP. Come back tomorrow!" }, { status: 429 });
  }
  return forwardToAgent(`runs/${id}/resume`, postJson({}));
}
