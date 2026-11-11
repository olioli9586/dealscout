import { ADMIN_TOKEN_NEEDED, canDecide } from "@/lib/admin";
import { forwardToAgent, isRunId, postJson } from "@/lib/agent-service";

export const runtime = "nodejs";
export const maxDuration = 300;

// Answers the approval step: {"action": "approve" | "reject"} or
// {"action": "edit", "profile": {...}}. The agent validates the shape.
// Needs the admin token where V2_ADMIN_TOKEN is set (lib/admin.ts).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRunId(id)) return Response.json({ error: "No such run." }, { status: 404 });
  if (!canDecide(req)) return Response.json({ error: ADMIN_TOKEN_NEEDED }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  return forwardToAgent(`runs/${id}/decision`, postJson(body));
}
