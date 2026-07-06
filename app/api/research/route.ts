import { NextRequest } from "next/server";
import { runResearchAgent, type AgentEvent } from "@/lib/agent";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Research runs can take a few minutes at high effort.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Server is not configured: ANTHROPIC_API_KEY is missing." },
      { status: 500 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, remaining } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: "Daily demo limit reached for your IP. Come back tomorrow!" },
      { status: 429 },
    );
  }

  let company: string;
  try {
    const body = await req.json();
    company = String(body.company ?? "").trim();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!company || company.length > 200) {
    return Response.json({ error: "Provide a company name (max 200 chars)." }, { status: 400 });
  }

  // Newline-delimited JSON stream: one AgentEvent per line.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        emit({ type: "status", message: `Starting research on "${company}"…` });
        await runResearchAgent(company, emit);
      } catch (err) {
        console.error("research agent failed:", err);
        emit({ type: "error", message: "Something went wrong during research. Please retry." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Demo-Requests-Remaining": String(remaining),
    },
  });
}
