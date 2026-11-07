import { forwardToAgent, isRunId, postJson } from "@/lib/agent-service";

export const runtime = "nodejs";
export const maxDuration = 300;

// Continues a run that failed or was cut off, from its last checkpoint.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRunId(id)) return Response.json({ error: "No such run." }, { status: 404 });
  return forwardToAgent(`runs/${id}/resume`, postJson({}));
}
