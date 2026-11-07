import { forwardToAgent, isRunId } from "@/lib/agent-service";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRunId(id)) return Response.json({ error: "No such run." }, { status: 404 });
  return forwardToAgent(`runs/${id}`);
}
