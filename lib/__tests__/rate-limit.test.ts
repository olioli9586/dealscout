import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// rate-limit.ts reads DEMO_DAILY_LIMIT and holds its counters at module
// scope, so each test imports a fresh copy.
async function load(limit?: string) {
  vi.resetModules();
  if (limit === undefined) vi.stubEnv("DEMO_DAILY_LIMIT", undefined as unknown as string);
  else vi.stubEnv("DEMO_DAILY_LIMIT", limit);
  return import("@/lib/rate-limit");
}

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("allows up to the daily limit per IP, then blocks", async () => {
    const { checkRateLimit } = await load("3");
    expect(checkRateLimit("1.1.1.1")).toEqual({ allowed: true, remaining: 2 });
    expect(checkRateLimit("1.1.1.1")).toEqual({ allowed: true, remaining: 1 });
    expect(checkRateLimit("1.1.1.1")).toEqual({ allowed: true, remaining: 0 });
    expect(checkRateLimit("1.1.1.1")).toEqual({ allowed: false, remaining: 0 });
    // Other IPs have their own budget.
    expect(checkRateLimit("2.2.2.2")).toEqual({ allowed: true, remaining: 2 });
  });

  it("resets the counter on a new UTC day", async () => {
    const { checkRateLimit } = await load("1");
    expect(checkRateLimit("1.1.1.1").allowed).toBe(true);
    expect(checkRateLimit("1.1.1.1").allowed).toBe(false);
    vi.setSystemTime(new Date("2026-09-26T00:00:01Z"));
    expect(checkRateLimit("1.1.1.1")).toEqual({ allowed: true, remaining: 0 });
  });

  it("defaults to 10 per day when DEMO_DAILY_LIMIT is unset", async () => {
    const { checkRateLimit } = await load();
    for (let i = 0; i < 10; i++) expect(checkRateLimit("ip").allowed).toBe(true);
    expect(checkRateLimit("ip").allowed).toBe(false);
  });

  it("falls back to the default instead of disabling the cap on a malformed value", async () => {
    const { checkRateLimit } = await load("ten");
    for (let i = 0; i < 10; i++) checkRateLimit("ip");
    expect(checkRateLimit("ip")).toEqual({ allowed: false, remaining: 0 });
  });

  it("blocks every request when the limit is 0", async () => {
    const { checkRateLimit } = await load("0");
    expect(checkRateLimit("ip")).toEqual({ allowed: false, remaining: 0 });
  });

  it("drops counters from previous days instead of keeping them forever", async () => {
    const mod = await load("5");
    for (let i = 0; i < 100; i++) mod.checkRateLimit(`10.0.0.${i}`);
    expect(mod.trackedIpCount()).toBe(100);
    vi.setSystemTime(new Date("2026-09-26T08:00:00Z"));
    mod.checkRateLimit("10.0.0.1");
    expect(mod.trackedIpCount()).toBe(1);
  });
});
