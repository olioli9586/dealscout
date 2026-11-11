import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DealScout v2 — multi-agent research with your approval",
  description:
    "A planner, parallel researchers, a verifier that checks every claim against its source, and a writer; nothing is saved until you approve it.",
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return children;
}
