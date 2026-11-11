import { describe, expect, it } from "vitest";
import { responseCost } from "@/lib/pricing";

describe("responseCost", () => {
  it("prices every token kind and each web search", () => {
    // Sonnet 4.6: $3 in, $3.75 cache write, $0.30 cache read, $15 out per MTok.
    const cost = responseCost("claude-sonnet-4-6", {
      input_tokens: 100_000,
      output_tokens: 2_000,
      cache_creation_input_tokens: 10_000,
      cache_read_input_tokens: 50_000,
      server_tool_use: { web_search_requests: 3, web_fetch_requests: 2 },
    });
    // 0.3 + 0.0375 + 0.015 + 0.03 tokens, plus 3 x $0.01 searches; fetches are free.
    expect(cost).toBeCloseTo(0.4125, 10);
  });

  it("treats missing cache and tool fields as zero", () => {
    expect(responseCost("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(4);
  });

  it("switches Haiku 5.5 to its long-prompt rates past 100,000 prompt tokens", () => {
    const at = responseCost("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 0 });
    const over = responseCost("claude-haiku-5-5", {
      input_tokens: 90_000,
      cache_read_input_tokens: 10_001,
      output_tokens: 1_000,
    });
    expect(at).toBeCloseTo(0.01, 10);
    expect(over).toBeCloseTo((90_000 * 0.5 + 10_001 * 0.05 + 1_000 * 2.5) / 1e6, 10);
  });

  it("is null for a model it has no price for", () => {
    expect(responseCost("claude-retired-model", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });
});
