import type { CompanyProfile } from "@/lib/agent";

export const CSV_COLUMNS: (keyof CompanyProfile)[] = [
  "company_name", "website", "industry", "hq_location", "founded_year",
  "employee_count", "business_model", "products_services", "funding_status",
  "recent_news", "deal_signals", "confidence", "summary",
];

// Profile text comes from arbitrary web pages. A cell starting with one of
// these characters is evaluated as a formula by Excel / Sheets (CSV
// injection), so it is prefixed with an apostrophe to force plain text.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function cell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Serialize profiles to CSV (one row per profile; list fields joined with "; "). */
export function profilesToCsv(profiles: CompanyProfile[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = profiles.map((p) =>
    CSV_COLUMNS.map((c) => {
      const v = p[c];
      return cell(Array.isArray(v) ? v.join("; ") : String(v ?? ""));
    }).join(","),
  );
  return [header, ...lines].join("\n");
}
