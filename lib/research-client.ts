import type { AgentEvent, CompanyProfile } from "@/lib/agent";

// Browser-side client for POST /api/research, shared by the home page and
// batch mode. The route streams newline-delimited JSON, one AgentEvent per
// line.

/** The visitor's daily demo quota is used up (HTTP 429). */
export class RateLimitError extends Error {
  name = "RateLimitError";
}

/**
 * Start a research run and call `onEvent` for every streamed event, in order.
 * An exception thrown from `onEvent` aborts the run and propagates.
 */
export async function streamResearch(
  company: string,
  onEvent: (event: AgentEvent) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    const message = data?.error ?? `Request failed (${res.status})`;
    throw res.status === 429 ? new RateLimitError(message) : new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string) => {
    if (line.trim()) onEvent(JSON.parse(line) as AgentEvent);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handle);
    }
    // Flush a final line that arrived without a trailing newline.
    handle(buffer + decoder.decode());
  } finally {
    // Stop the download if we bailed out early (e.g. on an error event).
    reader.cancel().catch(() => {});
  }
}

/** Run research to completion and return the profile, or throw. */
export async function researchCompany(
  company: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CompanyProfile> {
  // Assigned inside the callback; the cast stops TS narrowing it to `null`.
  let profile = null as CompanyProfile | null;
  await streamResearch(
    company,
    (event) => {
      if (event.type === "profile") profile = event.profile;
      if (event.type === "error") throw new Error(event.message);
    },
    fetchImpl,
  );
  if (!profile) throw new Error("Hit the server time limit — retry this one");
  return profile;
}
