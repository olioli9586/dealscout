// Small pieces shared by the v2 pages. Not a route: only page and route
// files under app/ are served.

import type { RunStatus } from "@/lib/v2-client";

const STATUS: Record<RunStatus | "cut_off", [string, string]> = {
  running: ["Running", "border-sky-200 bg-sky-50 text-sky-800"],
  awaiting_approval: ["Needs approval", "border-amber-200 bg-amber-50 text-amber-800"],
  saved: ["Saved", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  rejected: ["Rejected", "border-edge-strong bg-canvas text-soft"],
  failed: ["Failed", "border-red-200 bg-red-50 text-red-700"],
  cut_off: ["Cut off", "border-red-200 bg-red-50 text-red-700"],
};

/** A run's status; a "running" run whose lease ran out was cut off. */
export function StatusBadge({ status, resumable }: { status: RunStatus; resumable: boolean }) {
  const [label, style] = STATUS[status === "running" && resumable ? "cut_off" : status];
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}>{label}</span>
  );
}

export const usd = (x: number | null | undefined) => (typeof x === "number" ? `$${x.toFixed(3)}` : "—");

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const FIELD_LABELS: Record<string, string> = {
  company_name: "Company",
  website: "Website",
  industry: "Industry",
  hq_location: "Headquarters",
  founded_year: "Founded",
  employee_count: "Employees",
  funding_status: "Funding",
  business_model: "Business model",
  products_services: "Products & services",
  leadership: "Leadership",
  recent_news: "Recent news",
  deal_signals: "Deal signals",
  confidence: "Confidence",
  summary: "Summary",
};

export const BRANCH_LABELS: Record<string, string> = {
  business: "Business & products",
  funding: "Funding & financials",
  leadership: "Leadership",
  news: "News & deal signals",
};

/**
 * The URL if it's http(s), else undefined. Sources reach the page from
 * researchers but also from a person's edit (the API takes any string),
 * and memory carries them into later runs, so a link is only made for web
 * pages.
 */
export function safeHref(url: string): string | undefined {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** "https://www.example.com/a/b" -> "example.com"; the input if it isn't a URL. */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A source's link text: its host, plus its path when another source shares the host. */
export function sourceLabel(url: string, all: string[]): string {
  const host = hostname(url);
  if (all.filter((u) => hostname(u) === host).length < 2) return host;
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    return path ? `${host}${path.length > 24 ? `${path.slice(0, 23)}…` : path}` : host;
  } catch {
    return host;
  }
}
