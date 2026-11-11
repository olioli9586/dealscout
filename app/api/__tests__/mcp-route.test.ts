import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { AgentEvent, CompanyProfile } from "@/lib/agent";

const runResearchAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent", () => ({ runResearchAgent }));

const PROFILE: CompanyProfile = {
  company_name: "Ramp",
  website: "ramp.com",
  industry: "FinTech",
  hq_location: "New York, NY",
  founded_year: "2019",
  employee_count: "1001-5000",
  business_model: "Interchange and SaaS fees.",
  products_services: ["Corporate cards"],
  funding_status: "Series E",
  recent_news: [],
  deal_signals: ["Tender offer"],
  confidence: "high",
  summary: "Spend management platform.",
};

function rpc(body: unknown, ip = "9.9.9.9"): NextRequest {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function loadRoute(limit = "5") {
  vi.resetModules();
  vi.stubEnv("DEMO_DAILY_LIMIT", limit);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  return import("@/app/api/mcp/route");
}

function callTool(company: unknown, id: number | string = 1) {
  return rpc({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "research_company", arguments: { company } },
  });
}

describe("MCP endpoint", () => {
  beforeEach(() => {
    runResearchAgent.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers initialize with protocol version and tool capability", async () => {
    const { POST } = await loadRoute();
    const res = await POST(rpc({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} }));
    const json = await res.json();
    expect(json.id).toBe(7);
    expect(json.result.protocolVersion).toBe("2025-06-18");
    expect(json.result.capabilities).toHaveProperty("tools");
  });

  it("lists the v1 tool and the three v2 tools", async () => {
    const { POST } = await loadRoute();
    const json = await (await POST(rpc({ jsonrpc: "2.0", id: "a", method: "tools/list" }))).json();
    expect(json.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "research_company",
      "start_profile_run",
      "get_profile_run",
      "decide_profile_run",
    ]);
  });

  it("accepts notifications with 202 and no body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("returns a JSON-RPC parse error for malformed JSON", async () => {
    const { POST } = await loadRoute();
    const json = await (await POST(rpc("{nope"))).json();
    expect(json.error.code).toBe(-32700);
  });

  it.each([
    ["null", "null"],
    ["numeric", "42"],
    ["string", '"initialize"'],
    // JSON-RPC batching was removed from MCP in 2025-06-18.
    ["batch (array)", JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }])],
    ["method-less", JSON.stringify({ jsonrpc: "2.0", id: null })],
  ])("returns Invalid Request (not a crash) for a %s body", async (_label, body) => {
    const { POST } = await loadRoute();
    const res = await POST(rpc(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32600 } });
  });

  it("reports unknown methods with -32601", async () => {
    const { POST } = await loadRoute();
    const json = await (await POST(rpc({ jsonrpc: "2.0", id: 3, method: "resources/list" }))).json();
    expect(json).toMatchObject({ id: 3, error: { code: -32601 } });
  });

  it("rejects unknown tools and bad arguments with -32602", async () => {
    const { POST } = await loadRoute();
    const unknown = await (
      await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope" } }))
    ).json();
    expect(unknown.error.code).toBe(-32602);
    const blank = await (await POST(callTool("  "))).json();
    expect(blank.error.code).toBe(-32602);
    const long = await (await POST(callTool("x".repeat(201)))).json();
    expect(long.error.code).toBe(-32602);
    const notString = await (await POST(callTool({ name: "Ramp" }))).json();
    expect(notString.error.code).toBe(-32602);
    expect(runResearchAgent).not.toHaveBeenCalled();
  });

  it("returns the profile as text content on success", async () => {
    const { POST } = await loadRoute();
    runResearchAgent.mockImplementation(async (_c: string, emit: (e: AgentEvent) => void) => {
      emit({ type: "profile", profile: PROFILE });
      emit({ type: "done" });
    });
    const json = await (await POST(callTool(" Ramp "))).json();
    expect(runResearchAgent).toHaveBeenCalledWith("Ramp", expect.any(Function));
    expect(json.result.isError).toBeUndefined();
    expect(JSON.parse(json.result.content[0].text)).toEqual(PROFILE);
  });

  it("reports agent failures as tool errors (isError), not protocol errors", async () => {
    const { POST } = await loadRoute();
    runResearchAgent.mockImplementation(async (_c: string, emit: (e: AgentEvent) => void) => {
      emit({ type: "error", message: "The request was declined." });
    });
    const json = await (await POST(callTool("Ramp"))).json();
    expect(json.error).toBeUndefined();
    expect(json.result).toMatchObject({ isError: true });
    expect(json.result.content[0].text).toBe("The request was declined.");
  });

  it("reports a thrown agent error as a generic tool error", async () => {
    const { POST } = await loadRoute();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runResearchAgent.mockRejectedValue(new Error("upstream 529 detail"));
    const json = await (await POST(callTool("Ramp"))).json();
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).not.toContain("529");
    spy.mockRestore();
  });

  it("enforces the per-IP daily limit on tool calls", async () => {
    const { POST } = await loadRoute("1");
    runResearchAgent.mockImplementation(async (_c: string, emit: (e: AgentEvent) => void) => {
      emit({ type: "profile", profile: PROFILE });
    });
    await POST(callTool("Ramp"));
    const json = await (await POST(callTool("Ramp"))).json();
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/limit/i);
    expect(runResearchAgent).toHaveBeenCalledTimes(1);
  });

  it("rejects GET with 405", async () => {
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});

const RUN = "0b6f3b5e-6a4e-4a8e-9a43-3f1e2d9c7b10";

// Enough of the agent's run view for the summary.
const VIEW = {
  id: RUN,
  company: "Ramp",
  status: "awaiting_approval",
  error: null,
  draft: { company_name: "Ramp", website: "https://ramp.com" },
  changes: null,
  verdicts: [
    { branch: "business", rejected: [] },
    { branch: "funding", rejected: [{ field: "funding_status", value: "x", check: "quote", reason: "r" }] },
  ],
  saved_version: null,
  usage: { cost_usd: 0.12, calls: [{ node: "planner" }] },
};

describe("MCP v2 tools", () => {
  const fetchMock = vi.fn();

  function call(name: string, args: Record<string, unknown>) {
    return rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  }

  function agentCall(i = 0) {
    const [url, init] = fetchMock.mock.calls[i];
    return { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null };
  }

  beforeEach(() => {
    vi.stubEnv("AGENT_URL", "https://agent.internal");
    fetchMock.mockReset().mockImplementation(async () => Response.json(VIEW));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("starts a run and returns a summary with a link to its page", async () => {
    const { POST } = await loadRoute();
    const json = await (await POST(call("start_profile_run", { company: " Ramp " }))).json();
    expect(agentCall()).toEqual({ url: "https://agent.internal/runs", method: "POST", body: { company: "Ramp" } });
    expect(json.result.isError).toBeUndefined();
    const summary = JSON.parse(json.result.content[0].text);
    expect(summary).toMatchObject({
      id: RUN,
      status: "awaiting_approval",
      page: `http://localhost/v2/runs/${RUN}`,
      draft: VIEW.draft,
      cost_usd: 0.12,
    });
    expect(summary.rejected_claims).toEqual([VIEW.verdicts[1].rejected[0]]);
    // The per-call usage stays out of the summary.
    expect(summary.usage).toBeUndefined();
  });

  it("shares the per-IP daily limit with v1", async () => {
    const { POST } = await loadRoute("1");
    await POST(call("start_profile_run", { company: "Ramp" }));
    const json = await (await POST(call("start_profile_run", { company: "Ramp" }))).json();
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/limit/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a run and answers its approval step", async () => {
    const { POST } = await loadRoute();
    await POST(call("get_profile_run", { run_id: RUN }));
    await POST(call("decide_profile_run", { run_id: RUN, action: "approve" }));
    expect(agentCall(0)).toMatchObject({ url: `https://agent.internal/runs/${RUN}`, method: "GET" });
    expect(agentCall(1)).toEqual({
      url: `https://agent.internal/runs/${RUN}/decision`,
      method: "POST",
      body: { action: "approve" },
    });
  });

  it.each([
    ["start_profile_run", { company: "  " }],
    ["get_profile_run", { run_id: "../health" }],
    ["get_profile_run", {}],
    ["decide_profile_run", { run_id: RUN, action: "edit" }],
    ["decide_profile_run", { run_id: 7, action: "approve" }],
  ])("rejects bad arguments to %s with -32602 without calling the agent", async (name, args) => {
    const { POST } = await loadRoute();
    const json = await (await POST(call(name, args))).json();
    expect(json.error.code).toBe(-32602);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the agent's errors as tool errors", async () => {
    const { POST } = await loadRoute();
    fetchMock.mockImplementation(async () =>
      Response.json({ detail: "The run isn't waiting for approval." }, { status: 409 }),
    );
    const json = await (await POST(call("decide_profile_run", { run_id: RUN, action: "reject" }))).json();
    expect(json.result).toMatchObject({ isError: true });
    expect(json.result.content[0].text).toBe("The run isn't waiting for approval.");
  });

  it("needs the admin token to decide where V2_ADMIN_TOKEN is set", async () => {
    const { POST } = await loadRoute();
    vi.stubEnv("V2_ADMIN_TOKEN", "s3cret-token");
    const args = { run_id: RUN, action: "approve" };
    const refused = await (await POST(call("decide_profile_run", args))).json();
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0].text).toMatch(/admin token/);
    expect(fetchMock).not.toHaveBeenCalled();
    const req = rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "decide_profile_run", arguments: args } });
    req.headers.set("authorization", "Bearer s3cret-token");
    const json = await (await POST(req)).json();
    expect(json.result.isError).toBeUndefined();
    expect(agentCall().body).toEqual({ action: "approve" });
  });

  it("reports an unreachable agent as a tool error", async () => {
    const { POST } = await loadRoute();
    vi.stubEnv("AGENT_URL", "");
    const json = await (await POST(call("get_profile_run", { run_id: RUN }))).json();
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/unreachable/);
  });
});
