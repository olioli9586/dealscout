import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, CompanyProfile } from "@/lib/agent";

// The Anthropic SDK is replaced with a scripted fake: each call to
// messages.stream() plays back the next scripted turn. No network is used.
const sdk = vi.hoisted(() => {
  class NotFoundError extends Error {}
  return { NotFoundError, stream: vi.fn() };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static NotFoundError = sdk.NotFoundError;
    messages = { stream: sdk.stream };
  }
  return { default: Anthropic };
});

const PROFILE: CompanyProfile = {
  company_name: "Neon",
  website: "neon.tech",
  industry: "Databases",
  hq_location: "San Francisco, CA",
  founded_year: "2021",
  employee_count: "51-200",
  business_model: "Usage-based serverless Postgres.",
  products_services: ["Serverless Postgres"],
  funding_status: "Acquired by Databricks (2025)",
  recent_news: ["Acquired by Databricks"],
  deal_signals: ["Acquisition"],
  confidence: "high",
  summary: "Serverless Postgres provider.",
};

interface Turn {
  events?: unknown[];
  message?: { stop_reason: string; content: unknown[] };
  error?: Error;
}

type Params = {
  model: string;
  container?: string;
  messages: { role: string; content: unknown }[];
};

// Snapshot of each request's params (the agent mutates its messages array
// between calls, so the raw mock.calls entries all end up identical).
let requests: Params[] = [];

function script(...turns: Turn[]) {
  const queue = [...turns];
  sdk.stream.mockImplementation((params: Params) => {
    requests.push(structuredClone(params));
    const turn = queue.shift();
    if (!turn) throw new Error("agent made more requests than scripted");
    return {
      async *[Symbol.asyncIterator]() {
        if (turn.error) throw turn.error;
        for (const e of turn.events ?? []) yield e;
      },
      finalMessage: async () => turn.message,
    };
  });
}

const saveProfileTurn = (id = "toolu_1"): Turn => ({
  message: {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id, name: "save_profile", input: PROFILE }],
  },
});
const endTurn: Turn = {
  message: { stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] },
};

async function run(company = "Neon", env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { runResearchAgent } = await import("@/lib/agent");
  const events: AgentEvent[] = [];
  await runResearchAgent(company, (e) => events.push(e));
  return events;
}

const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe("runResearchAgent", () => {
  beforeEach(() => {
    sdk.stream.mockReset();
    requests = [];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("streams progress, captures the saved profile, and finishes", async () => {
    script(
      {
        events: [
          { type: "content_block_start", content_block: { type: "server_tool_use", name: "web_search" } },
          { type: "content_block_start", content_block: { type: "web_search_tool_result" } },
          { type: "content_block_start", content_block: { type: "server_tool_use", name: "web_fetch" } },
          { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "Found it." } },
          { type: "message_delta", delta: { container: { id: "cntr_1" } } },
        ],
        ...saveProfileTurn("toolu_42"),
      },
      endTurn,
    );

    const events = await run();

    expect(events).toEqual([
      { type: "status", message: "Searching the web…" },
      { type: "status", message: "Scanning search results…" },
      { type: "status", message: "Reading a source…" },
      { type: "thinking", text: "hmm" },
      { type: "text", text: "Found it." },
      { type: "profile", profile: PROFILE },
      { type: "done" },
    ]);

    expect(requests).toHaveLength(2);
    expect(requests[0].messages).toEqual([{ role: "user", content: "Research this company: Neon" }]);
    expect(requests[0].container).toBeUndefined();
    // The follow-up reuses the server-side container and answers the tool call.
    expect(requests[1].container).toBe("cntr_1");
    const [, assistant, toolResult] = requests[1].messages;
    expect(assistant.role).toBe("assistant");
    expect(toolResult).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_42" }],
    });
  });

  it("re-sends the conversation on pause_turn", async () => {
    const paused = { stop_reason: "pause_turn", content: [{ type: "text", text: "…" }] };
    script({ message: paused }, saveProfileTurn(), endTurn);

    const events = await run();

    expect(types(events)).toEqual(["profile", "done"]);
    expect(requests).toHaveLength(3);
    expect(requests[1].messages.at(-1)).toEqual({ role: "assistant", content: paused.content });
  });

  it("falls back to the default model once when the configured model 404s", async () => {
    script({ error: new sdk.NotFoundError("model not found") }, saveProfileTurn(), endTurn);

    const events = await run("Neon", { DEALSCOUT_MODEL: "claude-retired-model" });

    expect(requests.map((r) => r.model)).toEqual([
      "claude-retired-model",
      "claude-opus-4-8",
      "claude-opus-4-8",
    ]);
    expect(events[0]).toEqual({
      type: "status",
      message: "Model unavailable — switching to claude-opus-4-8…",
    });
    expect(types(events).slice(-2)).toEqual(["profile", "done"]);
  });

  it("does not retry forever when the fallback model also 404s", async () => {
    script({ error: new sdk.NotFoundError("model not found") });
    await expect(run()).rejects.toBeInstanceOf(sdk.NotFoundError);
    expect(requests).toHaveLength(1);
  });

  it("propagates API errors that happen before a profile exists", async () => {
    script({ error: new Error("overloaded") });
    await expect(run()).rejects.toThrow("overloaded");
  });

  it("reports a refusal as an error", async () => {
    script({ message: { stop_reason: "refusal", content: [] } });
    const events = await run();
    expect(types(events)).toEqual(["error"]);
  });

  it("reports an error when the model ends without saving a profile", async () => {
    script(endTurn);
    const events = await run();
    expect(events).toEqual([
      { type: "error", message: "Research finished without a structured profile. Please try again." },
    ]);
  });

  it("gives up after the iteration cap", async () => {
    const paused: Turn = { message: { stop_reason: "pause_turn", content: [] } };
    script(...Array.from({ length: 6 }, () => paused));
    const events = await run();
    expect(requests).toHaveLength(6);
    expect(types(events)).toEqual(["error"]);
  });

  it("still completes when the closing turn fails after the profile was saved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    script(saveProfileTurn(), { error: new Error("overloaded") });

    const events = await run();

    expect(types(events)).toEqual(["profile", "done"]);
  });

  it("does not turn a refusal on the closing turn into an error", async () => {
    script(saveProfileTurn(), { message: { stop_reason: "refusal", content: [] } });
    const events = await run();
    expect(types(events)).toEqual(["profile", "done"]);
  });
});
