import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  HISTORY_KEY,
  HISTORY_MAX,
  branchProgress,
  fromForm,
  launch,
  listRuns,
  readHistory,
  remember,
  startRun,
  starts,
  toForm,
  type RunView,
  type V2Profile,
} from "@/lib/v2-client";

const A = "0b6f3b5e-6a4e-4a8e-9a43-3f1e2d9c7b10";
const B = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[HISTORY_KEY, initial]]);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    raw: () => data.get(HISTORY_KEY),
  };
}

describe("history", () => {
  it("keeps the newest run first, once", () => {
    const storage = memoryStorage();
    remember(storage, A);
    remember(storage, B);
    remember(storage, A);
    expect(readHistory(storage)).toEqual([A, B]);
  });

  it("keeps at most HISTORY_MAX runs", () => {
    const storage = memoryStorage();
    for (let i = 0; i < HISTORY_MAX + 5; i++) remember(storage, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(readHistory(storage)).toHaveLength(HISTORY_MAX);
  });

  it.each([["not json"], ['{"a": 1}'], [JSON.stringify([A, "../x", 7])]])("survives a damaged entry: %s", (raw) => {
    expect(readHistory(memoryStorage(raw))).toEqual(raw.includes(A) ? [A] : []);
  });
});

describe("api calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts a run with the browser's id and surfaces the API's error and status", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "Daily demo limit reached" }, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await startRun("Ramp", A).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.message, err.status]).toEqual(["Daily demo limit reached", 429]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, JSON.parse(String(init.body))]).toEqual(["/api/v2/runs", { company: "Ramp", id: A }]);
  });

  it("launches a run under a new id, remembers it, and keeps the request for the run page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "The agent is unreachable" }, { status: 503 })));
    const storage = memoryStorage();
    const id = launch("Ramp", storage);
    expect(readHistory(storage)).toEqual([id]);
    await expect(starts.get(id)).rejects.toMatchObject({ status: 503 });
  });

  it("asks for nothing when the history is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await listRuns([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function run(changes: Partial<RunView>): RunView {
  return {
    plan: [],
    findings: [],
    verdicts: [],
    next: [],
    ...changes,
  } as RunView;
}

describe("branchProgress", () => {
  it("shows each planned branch researching, verifying, then done, with a retry as a second pass", () => {
    const rejected = [
      { field: "funding_status", value: "x", source_url: "u", check: "quote" as const, reason: "too vague" },
    ];
    const progress = branchProgress(
      run({
        plan: ["business", "funding", "news"],
        findings: [
          { branch: "business", attempt: 1, claims: 7, tool_errors: [] },
          { branch: "funding", attempt: 1, claims: 4, tool_errors: [] },
          { branch: "funding", attempt: 2, claims: 3, tool_errors: ["web_search: too_many_requests"] },
        ],
        verdicts: [
          { branch: "business", attempt: 1, supported: 6, unsupported: 1, rejected: [] },
          { branch: "funding", attempt: 1, supported: 1, unsupported: 3, rejected },
        ],
      }),
    );
    expect(progress.map((b) => [b.branch, b.passes.map((p) => p.step)])).toEqual([
      ["business", ["done"]],
      ["funding", ["done", "verifying"]],
      ["news", ["researching"]],
    ]);
    const funding = progress[1].passes;
    expect([funding[0].supported, funding[0].rejected, funding[1].toolErrors]).toEqual([
      1,
      rejected,
      ["web_search: too_many_requests"],
    ]);
  });
});

describe("editing", () => {
  const draft: V2Profile = {
    company_name: "Ramp",
    website: "ramp.com",
    industry: "Fintech",
    hq_location: "New York, NY",
    founded_year: "2019",
    employee_count: "unknown",
    business_model: "Card interchange",
    products_services: ["Cards", "Bill pay"],
    funding_status: "Series E",
    leadership: ["Eric Glyman, CEO"],
    recent_news: [],
    deal_signals: [],
    confidence: "high",
    summary: "Spend management.",
    sources: { website: ["https://ramp.com/"], leadership: ["https://ramp.com/team"] },
    carried_over: ["industry"],
  };

  it("round-trips a profile, one list item per line", () => {
    const form = toForm(draft);
    expect(form.products_services).toBe("Cards\nBill pay");
    const { carried_over, ...rest } = draft;
    expect(carried_over).toBeDefined();
    expect(fromForm(form, draft)).toEqual(rest);
  });

  it("drops blank lines, turns an emptied text field into unknown, and forgets carried_over", () => {
    const form = { ...toForm(draft), leadership: "Eric Glyman, CEO\n\n  Karim Atiyeh, CTO  \n", industry: "  " };
    const edited = fromForm(form, draft);
    expect(edited.leadership).toEqual(["Eric Glyman, CEO", "Karim Atiyeh, CTO"]);
    expect(edited.industry).toBe("unknown");
    expect(edited.carried_over).toBeUndefined();
    // The edited field loses the pages that backed its old value; the rest keep theirs.
    expect(edited.sources).toEqual({ website: ["https://ramp.com/"] });
  });
});
