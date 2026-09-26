// Demo-mode rate limiting: per-IP daily cap, kept in memory.
//
// Known limitation (deliberate for the MVP): on serverless, each warm instance
// has its own Map, so the real-world cap is (limit x instances). That is good
// enough to stop a stranger from burning the API budget on a portfolio demo.
// The production fix would be a shared store (Upstash Redis / Postgres) — see
// the "Design decisions" section of the README.

const DEFAULT_DAILY_LIMIT = 10;

// A malformed value (e.g. "ten") must not silently disable the cap: NaN makes
// every `count >= limit` comparison false. Fall back to the default instead.
function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
}

const DAILY_LIMIT = parseLimit(process.env.DEMO_DAILY_LIMIT);

// Counters for the current UTC day only. When the day rolls over, the whole
// map is dropped so a long-lived instance doesn't accumulate one entry per IP
// forever.
const usage = new Map<string, number>();
let usageDay = "";

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== usageDay) {
    usage.clear();
    usageDay = today;
  }

  const count = usage.get(ip) ?? 0;
  if (count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  usage.set(ip, count + 1);
  return { allowed: true, remaining: DAILY_LIMIT - count - 1 };
}

/** Number of IPs currently tracked (exposed for tests). */
export function trackedIpCount(): number {
  return usage.size;
}
