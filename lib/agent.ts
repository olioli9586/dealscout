import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// DealScout research agent
//
// Design decisions (see README for the full write-up):
// - Hand-rolled agent loop over the official Anthropic SDK instead of a
//   framework, so every step (tool_use -> tool_result -> loop) is explicit.
// - Web research uses Anthropic's *server-side* web_search / web_fetch tools:
//   they execute on Anthropic's infrastructure, so no scraper or search-API
//   key is needed here. When the server-side loop hits its iteration limit
//   the API returns stop_reason "pause_turn" and we simply re-send to resume.
// - The final answer is captured through a custom `save_profile` tool with
//   strict schema validation, which guarantees the profile parses instead of
//   hoping the model emits clean JSON in prose.
// ---------------------------------------------------------------------------

export interface CompanyProfile {
  company_name: string;
  website: string;
  industry: string;
  hq_location: string;
  founded_year: string;
  employee_count: string;
  business_model: string;
  products_services: string[];
  funding_status: string;
  recent_news: string[];
  deal_signals: string[];
  confidence: "low" | "medium" | "high";
  summary: string;
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "profile"; profile: CompanyProfile }
  | { type: "done" }
  | { type: "error"; message: string };

const MODEL = process.env.DEALSCOUT_MODEL ?? "claude-opus-4-8";
const FALLBACK_MODEL = "claude-opus-4-8";
const MAX_ITERATIONS = 6;
// Runs must fit inside the deployment platform's 300s function limit. Lower
// effort makes the model consolidate tool calls and conclude sooner.
const EFFORT = (process.env.DEALSCOUT_EFFORT ?? "medium") as "low" | "medium" | "high";

const SYSTEM_PROMPT = `You are DealScout, a company research analyst for a deal-sourcing team.

Given a company name (and optional hints), research it on the web and produce a
structured profile. You have a hard time budget of about four minutes, so work
fast: at most 3 targeted searches and 2 page fetches, then conclude. Prefer
"unknown" for a minor field over spending another search on it.

Rules:
- Prefer primary sources (company site, filings, reputable press).
- Never invent facts. If a field cannot be verified, write "unknown".
- deal_signals means concrete facts an M&A / investment team would care about:
  fundraising, leadership changes, layoffs, expansion, product launches, ownership.
- While researching, narrate briefly (one short line per step).
- When research is complete, call save_profile exactly once with every field filled.`;

const tools: Anthropic.Messages.ToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 4 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
  {
    name: "save_profile",
    description:
      "Save the final structured company profile. Call exactly once, after research is complete, with every field filled in. Use \"unknown\" (or an empty array) for anything that could not be verified.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        company_name: { type: "string" },
        website: { type: "string" },
        industry: { type: "string" },
        hq_location: { type: "string" },
        founded_year: { type: "string" },
        employee_count: { type: "string", description: "Approximate range, e.g. 51-200" },
        business_model: { type: "string", description: "How the company makes money, one sentence" },
        products_services: { type: "array", items: { type: "string" } },
        funding_status: { type: "string", description: "e.g. bootstrapped, Series B ($40M, 2025), public (NASDAQ: XYZ)" },
        recent_news: { type: "array", items: { type: "string" }, description: "Notable items from the last ~12 months" },
        deal_signals: { type: "array", items: { type: "string" } },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        summary: { type: "string", description: "2-3 sentence analyst summary" },
      },
      required: [
        "company_name", "website", "industry", "hq_location", "founded_year",
        "employee_count", "business_model", "products_services", "funding_status",
        "recent_news", "deal_signals", "confidence", "summary",
      ],
      additionalProperties: false,
    },
  },
];

export async function runResearchAgent(
  company: string,
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Research this company: ${company}` },
  ];

  let profileSaved = false;
  // If the configured model is retired/unavailable (404), fall back once.
  let model = MODEL;
  // The _20260209 web tools run code execution (dynamic filtering) inside a
  // server-side container. Follow-up requests in the loop must reference that
  // same container or the API rejects them with "container_id is required".
  let containerId: string | undefined;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const stream = client.messages.stream({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: EFFORT },
      tools,
      messages,
      ...(containerId ? { container: containerId } : {}),
    });

    let response: Anthropic.Message;
    try {
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "server_tool_use") {
          emit({
            type: "status",
            message: block.name === "web_search" ? "Searching the web…" : "Reading a source…",
          });
        } else if (block.type === "web_search_tool_result") {
          emit({ type: "status", message: "Scanning search results…" });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          emit({ type: "text", text: event.delta.text });
        } else if (event.delta.type === "thinking_delta" && event.delta.thinking) {
          emit({ type: "thinking", text: event.delta.thinking });
        }
      } else if (event.type === "message_delta") {
        // The container id arrives on message_delta and is NOT merged into
        // finalMessage() by the SDK accumulator — capture it here.
        if (event.delta.container?.id) containerId = event.delta.container.id;
      }
    }

    response = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.NotFoundError && model !== FALLBACK_MODEL) {
        model = FALLBACK_MODEL;
        emit({ type: "status", message: `Model unavailable — switching to ${FALLBACK_MODEL}…` });
        continue; // retry the request on the fallback model
      }
      throw err;
    }
    // Echo the assistant turn back verbatim (thinking blocks included) so the
    // next request in the loop is valid.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") {
      // Server-side tool loop hit its iteration limit; re-send to resume.
      continue;
    }

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use" && block.name === "save_profile") {
          // strict: true guarantees the input matches the schema.
          emit({ type: "profile", profile: block.input as CompanyProfile });
          profileSaved = true;
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Profile saved. Reply with one closing sentence.",
          });
        }
      }
      if (toolResults.length > 0) {
        messages.push({ role: "user", content: toolResults });
        continue;
      }
    }

    if (response.stop_reason === "refusal") {
      emit({ type: "error", message: "The request was declined. Try a different company name." });
      return;
    }

    // end_turn (or anything else terminal)
    break;
  }

  if (!profileSaved) {
    emit({
      type: "error",
      message: "Research finished without a structured profile. Please try again.",
    });
    return;
  }
  emit({ type: "done" });
}
