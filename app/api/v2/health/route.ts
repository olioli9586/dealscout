import { forwardToAgent } from "@/lib/agent-service";

export const runtime = "nodejs";

// Whether this deployment can reach the v2 agent, and the agent its database.
export async function GET() {
  return forwardToAgent("health");
}
