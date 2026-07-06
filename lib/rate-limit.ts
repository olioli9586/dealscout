// Demo-mode rate limiting: per-IP daily cap, kept in memory.
//
// Known limitation (deliberate for the MVP): on serverless, each warm instance
// has its own Map, so the real-world cap is (limit x instances). That is good
// enough to stop a stranger from burning the API budget on a portfolio demo.
// The production fix would be a shared store (Upstash Redis / Postgres) — see
// the "Design decisions" section of the README.

const DAILY_LIMIT = Number(process.env.DEMO_DAILY_LIMIT ?? 10);

const usage = new Map<string, { day: string; count: number }>();

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const today = new Date().toISOString().slice(0, 10);
  const entry = usage.get(ip);

  if (!entry || entry.day !== today) {
    usage.set(ip, { day: today, count: 1 });
    return { allowed: true, remaining: DAILY_LIMIT - 1 };
  }

  if (entry.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: DAILY_LIMIT - entry.count };
}
