import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const RUN = "0b6f3b5e-6a4e-4a8e-9a43-3f1e2d9c7b10";
const fetchMock = vi.fn();

function request(url: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${url}`, {
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
    ...init,
  }) as unknown as NextRequest;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function agentCall(i = 0): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[i];
  return { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null };
}

describe("v2 routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AGENT_URL", "https://agent.internal");
    vi.stubEnv("DEMO_DAILY_LIMIT", "1");
    fetchMock.mockReset().mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("starts a run with the trimmed company name", async () => {
    const { POST } = await import("@/app/api/v2/runs/route");
    const res = await POST(request("/api/v2/runs", { method: "POST", body: JSON.stringify({ company: " Ramp " }) }));
    expect(res.status).toBe(200);
    expect(agentCall()).toEqual({ url: "https://agent.internal/runs", method: "POST", body: { company: "Ramp" } });
  });

  it.each([["{nope"], [JSON.stringify({ company: "  " })], [JSON.stringify({ company: "x".repeat(201) })]])(
    "rejects %s without spending the quota",
    async (body) => {
      const { POST } = await import("@/app/api/v2/runs/route");
      expect((await POST(request("/api/v2/runs", { method: "POST", body }))).status).toBe(400);
      const ok = await POST(request("/api/v2/runs", { method: "POST", body: JSON.stringify({ company: "Ramp" }) }));
      expect(ok.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("answers 429 once the daily quota is used up", async () => {
    const { POST } = await import("@/app/api/v2/runs/route");
    const start = () => POST(request("/api/v2/runs", { method: "POST", body: JSON.stringify({ company: "Ramp" }) }));
    expect((await start()).status).toBe(200);
    expect((await start()).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads, resumes and decides by run id", async () => {
    const { GET } = await import("@/app/api/v2/runs/[id]/route");
    const { POST: resume } = await import("@/app/api/v2/runs/[id]/resume/route");
    const { POST: decide } = await import("@/app/api/v2/runs/[id]/decision/route");
    await GET(request(`/api/v2/runs/${RUN}`), params(RUN));
    await resume(request(`/api/v2/runs/${RUN}/resume`, { method: "POST" }), params(RUN));
    const edit = { action: "edit", profile: { name: "Ramp" } };
    await decide(request(`/api/v2/runs/${RUN}/decision`, { method: "POST", body: JSON.stringify(edit) }), params(RUN));

    expect([agentCall(0), agentCall(1), agentCall(2)]).toEqual([
      { url: `https://agent.internal/runs/${RUN}`, method: "GET", body: null },
      { url: `https://agent.internal/runs/${RUN}/resume`, method: "POST", body: {} },
      { url: `https://agent.internal/runs/${RUN}/decision`, method: "POST", body: edit },
    ]);
  });

  it("answers 404 for an id that isn't a UUID, without calling the agent", async () => {
    const { GET } = await import("@/app/api/v2/runs/[id]/route");
    const { POST: resume } = await import("@/app/api/v2/runs/[id]/resume/route");
    const { POST: decide } = await import("@/app/api/v2/runs/[id]/decision/route");
    expect((await GET(request("/api/v2/runs/x"), params("../health"))).status).toBe(404);
    expect((await resume(request("/api/v2/runs/x/resume"), params("x"))).status).toBe(404);
    const body = JSON.stringify({ action: "approve" });
    expect((await decide(request("/api/v2/runs/x/decision", { method: "POST", body }), params("x"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a decision that isn't JSON", async () => {
    const { POST } = await import("@/app/api/v2/runs/[id]/decision/route");
    const res = await POST(request(`/api/v2/runs/${RUN}/decision`, { method: "POST", body: "{nope" }), params(RUN));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
