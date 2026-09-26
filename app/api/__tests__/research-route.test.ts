import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { AgentEvent } from "@/lib/agent";

const runResearchAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent", () => ({ runResearchAgent }));

function post(body: string, ip = "9.9.9.9"): NextRequest {
  return new Request("http://localhost/api/research", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body,
  }) as unknown as NextRequest;
}

async function readEvents(res: Response): Promise<AgentEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function loadRoute(limit = "2") {
  vi.resetModules();
  vi.stubEnv("DEMO_DAILY_LIMIT", limit);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  return import("@/app/api/research/route");
}

describe("POST /api/research", () => {
  beforeEach(() => {
    runResearchAgent.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns 500 when the API key is not configured", async () => {
    const { POST } = await loadRoute();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(post(JSON.stringify({ company: "Ramp" })));
    expect(res.status).toBe(500);
    expect(runResearchAgent).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{nope"],
    ["a JSON null body", "null"],
    ["a missing company", "{}"],
    ["a blank company", JSON.stringify({ company: "   " })],
    ["a non-string company", JSON.stringify({ company: { name: "Ramp" } })],
    ["an overlong company", JSON.stringify({ company: "x".repeat(201) })],
  ])("rejects %s with 400", async (_label, body) => {
    const { POST } = await loadRoute();
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(runResearchAgent).not.toHaveBeenCalled();
  });

  it("does not spend the visitor's daily quota on invalid requests", async () => {
    const { POST } = await loadRoute("1");
    runResearchAgent.mockResolvedValue(undefined);
    await POST(post("{nope"));
    await POST(post(JSON.stringify({ company: "" })));
    const res = await POST(post(JSON.stringify({ company: "Ramp" })));
    expect(res.status).toBe(200);
    await res.text();
    expect(runResearchAgent).toHaveBeenCalledTimes(1);
  });

  it("returns 429 once the per-IP daily limit is used up", async () => {
    const { POST } = await loadRoute("1");
    runResearchAgent.mockResolvedValue(undefined);
    const ok = await POST(post(JSON.stringify({ company: "Ramp" })));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("X-Demo-Requests-Remaining")).toBe("0");
    await ok.text();
    const blocked = await POST(post(JSON.stringify({ company: "Ramp" })));
    expect(blocked.status).toBe(429);
    // A different client IP is unaffected.
    const other = await POST(post(JSON.stringify({ company: "Ramp" }), "8.8.8.8"));
    expect(other.status).toBe(200);
    await other.text();
  });

  it("streams agent events as NDJSON with the trimmed company name", async () => {
    const { POST } = await loadRoute();
    runResearchAgent.mockImplementation(async (_company: string, emit: (e: AgentEvent) => void) => {
      emit({ type: "text", text: "Looking up Ramp." });
      emit({ type: "done" });
    });
    const res = await POST(post(JSON.stringify({ company: "  Ramp  " })));
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    const events = await readEvents(res);
    expect(runResearchAgent).toHaveBeenCalledWith("Ramp", expect.any(Function));
    expect(events.map((e) => e.type)).toEqual(["status", "text", "done"]);
  });

  it("turns an agent crash into a generic error event without leaking details", async () => {
    const { POST } = await loadRoute();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runResearchAgent.mockRejectedValue(new Error("secret upstream detail"));
    const events = await readEvents(await POST(post(JSON.stringify({ company: "Ramp" }))));
    const last = events.at(-1)!;
    expect(last.type).toBe("error");
    expect(JSON.stringify(last)).not.toContain("secret upstream detail");
    spy.mockRestore();
  });
});
