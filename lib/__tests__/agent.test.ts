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
  message?: { stop_reason: string; content: unknown[]; usage?: unknown };
  error?: Error;
}

const NO_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
  server_tool_use: null,
};

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
      finalMessage: async () => ({ usage: NO_USAGE, ...turn.message }),
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
        message: {
          ...saveProfileTurn("toolu_42").message!,
          usage: {
            input_tokens: 1_000,
            output_tokens: 200,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 },
          },
        },
      },
      {
        message: {
          ...endTurn.message!,
          usage: { ...NO_USAGE, input_tokens: 1_500, output_tokens: 20 },
        },
      },
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
      {
        type: "usage",
        usage: {
          model: "claude-opus-4-8",
          effort: "medium",
          requests: 2,
          input_tokens: 2_500,
          output_tokens: 220,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          web_search_requests: 1,
          web_fetch_requests: 1,
          // Opus 4.8: 2,500 x $5 + 220 x $25 per MTok, plus one $0.01 search.
          cost_usd: expect.closeTo(0.028, 10),
        },
      },
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

    expect(types(events)).toEqual(["profile", "done", "usage"]);
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
    expect(types(events).slice(-3)).toEqual(["profile", "done", "usage"]);
    // The 404 has no usage; the two answered requests are priced as Opus 4.8.
    expect(events.at(-1)).toMatchObject({ usage: { model: "claude-opus-4-8", requests: 2, cost_usd: 0 } });
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

  it("still reports usage when the run throws", async () => {
    script(
      { message: { stop_reason: "pause_turn", content: [], usage: { ...NO_USAGE, input_tokens: 10 } } },
      { error: new Error("overloaded") },
    );
    vi.resetModules();
    const { runResearchAgent } = await import("@/lib/agent");
    const events: AgentEvent[] = [];
    await expect(runResearchAgent("Neon", (e) => events.push(e))).rejects.toThrow("overloaded");
    expect(events).toEqual([
      { type: "usage", usage: expect.objectContaining({ requests: 1, input_tokens: 10 }) },
    ]);
  });

  it("reports an unknown cost for a model with no price", async () => {
    script(saveProfileTurn(), endTurn);
    const events = await run("Neon", { DEALSCOUT_MODEL: "claude-unpriced-model" });
    expect(events.at(-1)).toMatchObject({ usage: { model: "claude-unpriced-model", cost_usd: null } });
  });

  it("reports a refusal as an error", async () => {
    script({ message: { stop_reason: "refusal", content: [] } });
    const events = await run();
    expect(types(events)).toEqual(["error", "usage"]);
  });

  it("reports an error when the model ends without saving a profile", async () => {
    script(endTurn);
    const events = await run();
    expect(events.slice(0, -1)).toEqual([
      { type: "error", message: "Research finished without a structured profile. Please try again." },
    ]);
    expect(types(events).at(-1)).toBe("usage");
  });

  it("gives up after the iteration cap", async () => {
    const paused: Turn = { message: { stop_reason: "pause_turn", content: [] } };
    script(...Array.from({ length: 6 }, () => paused));
    const events = await run();
    expect(requests).toHaveLength(6);
    expect(types(events)).toEqual(["error", "usage"]);
  });

  it("still completes when the closing turn fails after the profile was saved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    script(saveProfileTurn(), { error: new Error("overloaded") });

    const events = await run();

    expect(types(events)).toEqual(["profile", "done", "usage"]);
  });

  it("does not turn a refusal on the closing turn into an error", async () => {
    script(saveProfileTurn(), { message: { stop_reason: "refusal", content: [] } });
    const events = await run();
    expect(types(events)).toEqual(["profile", "done", "usage"]);
  });
});
