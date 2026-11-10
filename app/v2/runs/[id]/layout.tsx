import type { Metadata } from "next";

// A run page is one person's run: reachable by its link, not listed or indexed.
export const metadata: Metadata = {
  title: "Run · DealScout v2",
  robots: { index: false, follow: false },
};

export default function RunLayout({ children }: { children: React.ReactNode }) {
  return children;
}
