import { forwardToAgent, isRunId, postJson } from "@/lib/agent-service";

export const runtime = "nodejs";
export const maxDuration = 300;

// Answers the approval step: {"action": "approve" | "reject"} or
// {"action": "edit", "profile": {...}}. The agent validates the shape.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRunId(id)) return Response.json({ error: "No such run." }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  return forwardToAgent(`runs/${id}/decision`, postJson(body));
}
