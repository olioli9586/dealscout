import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, CompanyProfile } from "@/lib/agent";
import { RateLimitError, researchCompany, streamResearch } from "@/lib/research-client";

const PROFILE = { company_name: "Ramp", confidence: "high" } as CompanyProfile;

/** A fetch stub whose response body arrives in the given raw chunks. */
function streamingFetch(chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch & {
    mock: { calls: unknown[][] };
  };
}

function jsonFetch(status: number, body: unknown) {
  return vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;
}

const line = (e: AgentEvent) => JSON.stringify(e) + "\n";

describe("streamResearch", () => {
  it("POSTs the company and delivers events in order across chunk boundaries", async () => {
    const all = line({ type: "status", message: "Searching…" }) + line({ type: "text", text: "héllo ✓" });
    // Split mid-line and mid-multibyte-character.
    const bytes = new TextEncoder().encode(all);
    const cut = bytes.length - 5;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 10));
        c.enqueue(bytes.slice(10, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body)) as unknown as typeof fetch;
    const events: AgentEvent[] = [];

    await streamResearch("Ramp", (e) => events.push(e), fetchImpl);

    expect(events).toEqual([
      { type: "status", message: "Searching…" },
      { type: "text", text: "héllo ✓" },
    ]);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0];
    expect(url).toBe("/api/research");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ company: "Ramp" });
  });

  it("handles a final event without a trailing newline", async () => {
    const fetchImpl = streamingFetch([
      line({ type: "status", message: "a" }),
      JSON.stringify({ type: "done" }),
    ]);
    const events: AgentEvent[] = [];
    await streamResearch("x", (e) => events.push(e), fetchImpl);
    expect(events.map((e) => e.type)).toEqual(["status", "done"]);
  });

  it("throws RateLimitError with the server's message on 429", async () => {
    const fetchImpl = jsonFetch(429, { error: "Daily demo limit reached for your IP." });
    const err = await streamResearch("x", () => {}, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.message).toBe("Daily demo limit reached for your IP.");
  });

  it("throws a plain Error for other failures", async () => {
    const err = await streamResearch("x", () => {}, jsonFetch(400, { error: "Bad name" })).catch(
      (e) => e,
    );
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(err.message).toBe("Bad name");

    const noJson = vi.fn(async () => new Response("oops", { status: 502 })) as unknown as typeof fetch;
    await expect(streamResearch("x", () => {}, noJson)).rejects.toThrow("Request failed (502)");
  });
});

describe("researchCompany", () => {
  it("returns the streamed profile", async () => {
    const fetchImpl = streamingFetch([
      line({ type: "status", message: "…" }),
      line({ type: "profile", profile: PROFILE }),
      line({ type: "done" }),
    ]);
    await expect(researchCompany("Ramp", fetchImpl)).resolves.toEqual(PROFILE);
  });

  it("throws the agent's error message", async () => {
    const fetchImpl = streamingFetch([line({ type: "error", message: "The request was declined." })]);
    await expect(researchCompany("Ramp", fetchImpl)).rejects.toThrow("The request was declined.");
  });

  it("keeps the profile when the stream is cut off mid-event", async () => {
    const fetchImpl = streamingFetch([
      line({ type: "profile", profile: PROFILE }),
      '{"type":"text","te',
    ]);
    await expect(researchCompany("Ramp", fetchImpl)).resolves.toEqual(PROFILE);
  });

  it("reports the timeout, not a JSON error, when a cut-off stream has no profile", async () => {
    const fetchImpl = streamingFetch([line({ type: "status", message: "…" }), '{"type":"sta']);
    await expect(researchCompany("Ramp", fetchImpl)).rejects.toThrow("server time limit");
  });

  it("reports a timeout (not a rate limit) when the stream ends without a profile", async () => {
    const fetchImpl = streamingFetch([line({ type: "status", message: "…" })]);
    const err = await researchCompany("Ramp", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    // Batch mode only stops early for RateLimitError; a per-row timeout must
    // not abort the rest of the batch.
    expect(err).not.toBeInstanceOf(RateLimitError);
  });
});
