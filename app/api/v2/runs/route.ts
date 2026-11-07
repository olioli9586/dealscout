import { NextRequest } from "next/server";
import { forwardToAgent, postJson } from "@/lib/agent-service";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// The request waits while the graph runs, up to the approval step.
export const maxDuration = 300;

// Starts a v2 run. Shares the v1 per-IP daily quota: both spend the same
// demo budget.
export async function POST(req: NextRequest) {
  let company: string;
  try {
    const body = await req.json();
    company = typeof body?.company === "string" ? body.company.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!company || company.length > 200) {
    return Response.json({ error: "Provide a company name (max 200 chars)." }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip).allowed) {
    return Response.json(
      { error: "Daily demo limit reached for your IP. Come back tomorrow!" },
      { status: 429 },
    );
  }
  return forwardToAgent("runs", postJson({ company }));
}
