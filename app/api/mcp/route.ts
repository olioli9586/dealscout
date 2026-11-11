import { NextRequest } from "next/server";
import { runResearchAgent, type CompanyProfile } from "@/lib/agent";
import { ADMIN_TOKEN_NEEDED, canDecide } from "@/lib/admin";
import { forwardToAgent, isRunId, postJson } from "@/lib/agent-service";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RunView } from "@/lib/v2-client";

export const runtime = "nodejs";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// A minimal MCP (Model Context Protocol) server over Streamable HTTP.
//
// Hand-rolled on purpose: MCP is JSON-RPC 2.0 over HTTP, and a stateless
// server that answers each POST with a plain JSON response is spec-compliant
// (clients accept `application/json` alongside `text/event-stream`). Any MCP
// client (Claude Desktop, IDEs, other agents) can use DealScout as a
// capability: research_company runs v1, and three tools drive a v2 run
// (start it, read it, approve or reject its draft) through the agent
// service, like the /api/v2 routes.
//
// Connect with:  { "type": "http", "url": "https://<host>/api/mcp" }
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";

const RESEARCH_TOOL = {
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

const RUN_ID_SCHEMA = { type: "string", description: "The run id (a UUID) from start_profile_run" };

const V2_TOOLS = [
  {
    name: "start_profile_run",
    description:
      "Start a DealScout v2 run: a planner, parallel researchers and a verifier that checks every claim against its source draft a company profile, then the run waits for a person to approve it. Waits for the draft (usually under a minute) and returns it with a source per field, the claims the verifier rejected and the cost.",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", description: "Company name, optionally with a hint, e.g. 'Neon (Postgres company)'" },
      },
      required: ["company"],
    },
  },
  {
    name: "get_profile_run",
    description:
      "Read a v2 run: its status (running, awaiting_approval, saved, rejected or failed), the draft profile with its sources, what changed since the saved profile, rejected claims and the cost.",
    inputSchema: { type: "object", properties: { run_id: RUN_ID_SCHEMA }, required: ["run_id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "decide_profile_run",
    description:
      "Approve or reject the draft of a v2 run that is awaiting approval. Approving saves it as the company's next profile version. Call this only after the user has seen the draft and asked to approve or reject it.",
    inputSchema: {
      type: "object",
      properties: { run_id: RUN_ID_SCHEMA, action: { type: "string", enum: ["approve", "reject"] } },
      required: ["run_id", "action"],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
];

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
  // Valid JSON is not necessarily a request object: `null` would crash on
  // msg.method below, and batches (arrays) are not part of this protocol
  // version.
  if (
    typeof msg !== "object" ||
    msg === null ||
    Array.isArray(msg) ||
    typeof msg.method !== "string"
  ) {
    return rpcError(null, -32600, "Invalid Request");
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
      return rpcResult(msg.id, { tools: [RESEARCH_TOOL, ...V2_TOOLS] });

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

type ToolArgs = { company?: unknown; run_id?: unknown; action?: unknown };

async function handleToolCall(req: NextRequest, msg: JsonRpcRequest) {
  const params = (msg.params ?? {}) as { name?: string; arguments?: ToolArgs };
  const args = params.arguments ?? {};
  switch (params.name) {
    case RESEARCH_TOOL.name:
      return researchCompany(req, msg, args);
    case "start_profile_run":
      return startRun(req, msg, args);
    case "get_profile_run":
      return getRun(req, msg, args);
    case "decide_profile_run":
      return decideRun(req, msg, args);
    default:
      return rpcError(msg.id, -32602, `Unknown tool: ${params.name}`);
  }
}

function companyArg(args: ToolArgs): string | null {
  const company = typeof args.company === "string" ? args.company.trim() : "";
  return company && company.length <= 200 ? company : null;
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function researchCompany(req: NextRequest, msg: JsonRpcRequest, args: ToolArgs) {
  const company = companyArg(args);
  if (!company) {
    return rpcError(msg.id, -32602, "Provide arguments.company (max 200 chars)");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return rpcError(msg.id, -32603, "Server is not configured: missing API key");
  }

  const { allowed } = checkRateLimit(clientIp(req));
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

// --- v2 runs, through the agent service -------------------------------------

async function startRun(req: NextRequest, msg: JsonRpcRequest, args: ToolArgs) {
  const company = companyArg(args);
  if (!company) {
    return rpcError(msg.id, -32602, "Provide arguments.company (max 200 chars)");
  }
  // The same per-IP daily quota as v1 and /api/v2/runs: one demo budget.
  if (!checkRateLimit(clientIp(req)).allowed) {
    return toolError(msg.id, "Daily demo limit reached for your IP. Come back tomorrow.");
  }
  return runReply(req, msg, await forwardToAgent("runs", postJson({ company })));
}

async function getRun(req: NextRequest, msg: JsonRpcRequest, args: ToolArgs) {
  if (typeof args.run_id !== "string" || !isRunId(args.run_id)) {
    return rpcError(msg.id, -32602, "Provide arguments.run_id (a UUID)");
  }
  return runReply(req, msg, await forwardToAgent(`runs/${args.run_id}`));
}

async function decideRun(req: NextRequest, msg: JsonRpcRequest, args: ToolArgs) {
  if (typeof args.run_id !== "string" || !isRunId(args.run_id)) {
    return rpcError(msg.id, -32602, "Provide arguments.run_id (a UUID)");
  }
  if (args.action !== "approve" && args.action !== "reject") {
    return rpcError(msg.id, -32602, 'Provide arguments.action: "approve" or "reject"');
  }
  if (!canDecide(req)) {
    return toolError(msg.id, `${ADMIN_TOKEN_NEEDED} Send it as a bearer token (your MCP client's Authorization header).`);
  }
  const res = await forwardToAgent(`runs/${args.run_id}/decision`, postJson({ action: args.action }));
  return runReply(req, msg, res);
}

// The agent's answer as a tool result: a summary of the run (not every
// model call's usage), with a link to its page, or the agent's error.
async function runReply(req: NextRequest, msg: JsonRpcRequest, res: Response) {
  const body = await res.json();
  if (!res.ok) return toolError(msg.id, body.error);
  const run = body as RunView;
  const summary = {
    id: run.id,
    company: run.company,
    status: run.status,
    error: run.error,
    page: new URL(`/v2/runs/${run.id}`, req.url).toString(),
    draft: run.draft,
    changes: run.changes,
    rejected_claims: run.verdicts.flatMap((v) => v.rejected),
    saved_version: run.saved_version,
    cost_usd: run.usage.cost_usd,
  };
  return rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] });
}

// Tool-level failures are reported inside the result (isError), not as
// JSON-RPC protocol errors — that's what lets the calling model see and
// react to the failure.
function toolError(id: number | string | null | undefined, message: string) {
  return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
}
