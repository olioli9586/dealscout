import { afterEach, describe, expect, it, vi } from "vitest";
import { agentFetch, forwardToAgent, isRunId } from "@/lib/agent-service";

const fetchMock = vi.fn();

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("agent-service", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it.each([
    ["https://agent.internal", "https://agent.internal/runs/x"],
    ["https://agent.internal/", "https://agent.internal/runs/x"],
    ["https://host/agent", "https://host/agent/runs/x"],
  ])("joins %s with the path", async (base, expected) => {
    vi.stubEnv("AGENT_URL", base);
    vi.stubGlobal("fetch", fetchMock.mockResolvedValue(answer(200, {})));
    await agentFetch("runs/x");
    expect(String(fetchMock.mock.calls[0][0])).toBe(expected);
  });

  it("answers 503 when AGENT_URL is not set", async () => {
    vi.stubEnv("AGENT_URL", "");
    const res = await forwardToAgent("health");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/AGENT_URL is not set/);
  });

  it("answers 503 when the agent can't be reached", async () => {
    vi.stubEnv("AGENT_URL", "https://agent.internal");
    vi.stubGlobal("fetch", fetchMock.mockRejectedValue(new TypeError("fetch failed")));
    const res = await forwardToAgent("health");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/unreachable: fetch failed/);
  });

  it("passes a success through with its status", async () => {
    vi.stubEnv("AGENT_URL", "https://agent.internal");
    vi.stubGlobal("fetch", fetchMock.mockResolvedValue(answer(201, { id: "r1" })));
    const res = await forwardToAgent("runs", { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "r1" });
  });

  it.each([
    [409, { detail: "the run is not waiting for approval" }, "the run is not waiting for approval"],
    [422, { detail: [{ msg: "Field required" }, { msg: "Value error, bad" }] }, "Field required; Value error, bad"],
    [500, "Internal Server Error", "The agent failed (HTTP 500)."],
  ])("turns an agent error %i into {error}", async (status, body, message) => {
    vi.stubEnv("AGENT_URL", "https://agent.internal");
    vi.stubGlobal("fetch", fetchMock.mockResolvedValue(answer(status, body)));
    const res = await forwardToAgent("runs/x/decision");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message });
  });

  it("accepts only UUIDs as run ids", () => {
    expect(isRunId("0b6f3b5e-6a4e-4a8e-9a43-3f1e2d9c7b10")).toBe(true);
    expect(isRunId("../health")).toBe(false);
    expect(isRunId("0b6f3b5e-6a4e-4a8e-9a43-3f1e2d9c7b10/../x")).toBe(false);
  });
});
