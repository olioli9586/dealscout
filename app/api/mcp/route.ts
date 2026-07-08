import { NextRequest } from "next/server";
import { runResearchAgent, type CompanyProfile } from "@/lib/agent";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// A minimal MCP (Model Context Protocol) server over Streamable HTTP.
//
// Hand-rolled on purpose: MCP is JSON-RPC 2.0 over HTTP, and a stateless
// server that answers each POST with a plain JSON response is spec-compliant
// (clients accept `application/json` alongside `text/event-stream`). This
// endpoint exposes one tool — research_company — so any MCP client
// (Claude Desktop, IDEs, other agents) can use DealScout as a capability.
//
// Connect with:  { "type": "http", "url": "https://<host>/api/mcp" }
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";

const TOOL = {
  name: "research_company",
  description:
    "Research a company on the web and return a structured deal-sourcing profile: industry, HQ, funding status, recent news, deal signals, and an analyst summary with a confidence rating. Takes 1-4 minutes.",
  inputSchema: {
    type: "object",
    properties: {
      company: {
        type: "string",
        description: "Company name, optionally with a hint, e.g. 'Neon (Postgres company)'",
      },
    },
    required: ["company"],
  },
};

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: number | string | null | undefined, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: number | string | null | undefined, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function POST(req: NextRequest) {
  let msg: JsonRpcRequest;
  try {
    msg = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  switch (msg.method) {
    case "initialize":
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "dealscout", version: "1.0.0" },
      });

    // Notifications carry no id and expect no body.
    case "notifications/initialized":
    case "notifications/cancelled":
      return new Response(null, { status: 202 });

    case "ping":
      return rpcResult(msg.id, {});

    case "tools/list":
      return rpcResult(msg.id, { tools: [TOOL] });

    case "tools/call":
      return handleToolCall(req, msg);

    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// Streamable HTTP allows a GET to open a server-push stream; this server is
// stateless and has nothing to push.
export async function GET() {
  return new Response("This MCP server is POST-only (stateless Streamable HTTP).", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

async function handleToolCall(req: NextRequest, msg: JsonRpcRequest) {
  const params = (msg.params ?? {}) as {
    name?: string;
    arguments?: { company?: string };
  };
  if (params.name !== TOOL.name) {
    return rpcError(msg.id, -32602, `Unknown tool: ${params.name}`);
  }
  const company = String(params.arguments?.company ?? "").trim();
  if (!company || company.length > 200) {
    return rpcError(msg.id, -32602, "Provide arguments.company (max 200 chars)");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return rpcError(msg.id, -32603, "Server is not configured: missing API key");
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed } = checkRateLimit(ip);
  if (!allowed) {
    return toolError(msg.id, "Daily demo limit reached for your IP. Come back tomorrow.");
  }

  let profile: CompanyProfile | null = null;
  let agentError: string | null = null;
  try {
    await runResearchAgent(company, (event) => {
      if (event.type === "profile") profile = event.profile;
      if (event.type === "error") agentError = event.message;
    });
  } catch (err) {
    console.error("mcp research failed:", err);
    agentError = "Research failed. Please retry.";
  }

  if (!profile) {
    return toolError(msg.id, agentError ?? "Research finished without a profile.");
  }
  return rpcResult(msg.id, {
    content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
  });
}

// Tool-level failures are reported inside the result (isError), not as
// JSON-RPC protocol errors — that's what lets the calling model see and
// react to the failure.
function toolError(id: number | string | null | undefined, message: string) {
  return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
}
