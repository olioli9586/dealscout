// What a research run costs, from the usage the API reports on each response.
//
// USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing
// (checked 2026-11-06). Cache writes are priced at the 5-minute rate, the only
// cache duration DealScout uses. Web fetch and the code execution that the
// _20260209 web tools run for dynamic filtering cost nothing beyond tokens;
// web search is $10 per 1,000 searches on top of its tokens.

interface Rates {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

const PRICES: Record<string, Rates> = {
  "claude-opus-5-5": { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  "claude-opus-4-8": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-sonnet-4-6": { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
};

// Haiku 5.5 has a second rate card for prompts over 100,000 tokens.
const HAIKU_LONG: Rates = { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 };
const HAIKU_LONG_AFTER = 100_000;

export const WEB_SEARCH_USD = 0.01;

/** The usage fields of one Messages API response that cost money. */
export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null;
}

/** Cost of one response in USD, or null for a model with no known price. */
export function responseCost(model: string, usage: ResponseUsage): number | null {
  let rates = PRICES[model];
  if (!rates) return null;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const prompt = usage.input_tokens + cacheWrite + cacheRead;
  if (model === "claude-haiku-5-5" && prompt > HAIKU_LONG_AFTER) rates = HAIKU_LONG;
  const tokens =
    usage.input_tokens * rates.input +
    cacheWrite * rates.cacheWrite +
    cacheRead * rates.cacheRead +
    usage.output_tokens * rates.output;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return tokens / 1_000_000 + searches * WEB_SEARCH_USD;
}
