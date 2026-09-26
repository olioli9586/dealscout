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

  it("lists the research_company tool", async () => {
    const { POST } = await loadRoute();
    const json = await (await POST(rpc({ jsonrpc: "2.0", id: "a", method: "tools/list" }))).json();
    expect(json.result.tools.map((t: { name: string }) => t.name)).toEqual(["research_company"]);
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
