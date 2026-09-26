import { describe, expect, it } from "vitest";
import type { CompanyProfile } from "@/lib/agent";
import { CSV_COLUMNS, profilesToCsv } from "@/lib/csv";

const base: CompanyProfile = {
  company_name: "Ramp",
  website: "ramp.com",
  industry: "FinTech",
  hq_location: "New York, NY",
  founded_year: "2019",
  employee_count: "1001-5000",
  business_model: "Interchange fees",
  products_services: ["Cards", "Bill pay"],
  funding_status: "Series E",
  recent_news: [],
  deal_signals: ["Tender offer"],
  confidence: "high",
  summary: "Spend management.",
};

const cells = (row: string) => row.slice(1, -1).split('","');

describe("profilesToCsv", () => {
  it("writes a header and one quoted row per profile", () => {
    const [header, row, ...rest] = profilesToCsv([base]).split("\n");
    expect(header).toBe(CSV_COLUMNS.join(","));
    expect(rest).toEqual([]);
    const values = cells(row);
    expect(values).toHaveLength(CSV_COLUMNS.length);
    expect(values[CSV_COLUMNS.indexOf("company_name")]).toBe("Ramp");
    expect(values[CSV_COLUMNS.indexOf("products_services")]).toBe("Cards; Bill pay");
    expect(values[CSV_COLUMNS.indexOf("recent_news")]).toBe("");
  });

  it("escapes embedded quotes and keeps commas/newlines inside the quoted cell", () => {
    const csv = profilesToCsv([{ ...base, summary: 'The "Amex killer", per\nanalysts' }]);
    expect(csv).toContain('"The ""Amex killer"", per\nanalysts"');
  });

  it("returns only the header for no profiles", () => {
    expect(profilesToCsv([])).toBe(CSV_COLUMNS.join(","));
  });

  it.each(["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1"])(
    "neutralizes spreadsheet formula injection in %j",
    (payload) => {
      const row = profilesToCsv([{ ...base, company_name: payload }]).split("\n")[1];
      const first = cells(row)[0];
      expect(first.startsWith("'")).toBe(true);
    },
  );

  it("leaves ordinary values untouched", () => {
    const row = profilesToCsv([{ ...base, funding_status: "$40M Series B (2025)" }]).split("\n")[1];
    expect(cells(row)[CSV_COLUMNS.indexOf("funding_status")]).toBe("$40M Series B (2025)");
  });
});
