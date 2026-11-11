import { NextRequest } from "next/server";
import { forwardToAgent, isRunId, postJson } from "@/lib/agent-service";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// How many runs one history request may ask for (the agent's limit too).
const MAX_IDS = 100;

export const runtime = "nodejs";
// The request waits while the graph runs, up to the approval step.
export const maxDuration = 300;

// Starts a v2 run. Shares the v1 per-IP daily quota: both spend the same
// demo budget. The browser may send the run's id, so it can open the run
// page and follow progress while this request runs the graph.
export async function POST(req: NextRequest) {
  let company: string;
  let id: unknown;
  try {
    const body = await req.json();
    company = typeof body?.company === "string" ? body.company.trim() : "";
    id = body?.id;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!company || company.length > 200) {
    return Response.json({ error: "Provide a company name (max 200 chars)." }, { status: 400 });
  }
  if (id !== undefined && (typeof id !== "string" || !isRunId(id))) {
    return Response.json({ error: "A run id must be a UUID." }, { status: 400 });
  }

  if (!checkRateLimit(clientIp(req)).allowed) {
    return Response.json(
      { error: "Daily demo limit reached for your IP. Come back tomorrow!" },
      { status: 429 },
    );
  }
  return forwardToAgent("runs", postJson(id === undefined ? { company } : { company, id }));
}

// The runs named in ?ids= (comma-separated), newest first: the run history,
// whose ids the browser keeps. There is no list of every run.
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0) return Response.json([]);
  if (ids.length > MAX_IDS || !ids.every(isRunId)) {
    return Response.json({ error: `Ask for up to ${MAX_IDS} run ids.` }, { status: 400 });
  }
  return forwardToAgent(`runs?ids=${ids.join(",")}`);
}
