import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import "./globals.css";

// The fonts ship in app/fonts (Latin subsets from Fontsource 5.3.0, SIL Open
// Font License): next/font/google fetched them at build time, and builds
// failed now and then on "next/font/google queries have exactly one entry".
const publicSans = localFont({
  variable: "--font-public-sans",
  src: [
    { path: "./fonts/public-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/public-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/public-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

const plexMono = localFont({
  variable: "--font-plex-mono",
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});

const bricolage = localFont({
  variable: "--font-bricolage",
  src: [
    { path: "./fonts/bricolage-grotesque-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "DealScout — Company research for deal sourcing",
  description:
    "Type a company name and get a structured research profile — funding, business model, and deal signals — built from live web sources.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${plexMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="border-b border-edge bg-surface">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2">
              {/* Scout mark: a radar frame with a blip */}
              <span
                aria-hidden
                className="relative inline-block h-[18px] w-[18px] rounded-[5px] border-2 border-navy"
              >
                <span className="absolute right-[2px] top-[2px] h-[5px] w-[5px] rounded-full bg-accent" />
              </span>
              <span className="font-display text-[17px] font-bold tracking-tight text-ink">
                DealScout
              </span>
            </Link>
            <nav className="flex items-center gap-5 text-sm text-soft">
              <Link href="/" className="transition hover:text-ink">
                Research
              </Link>
              <Link href="/batch" className="transition hover:text-ink">
                Batch
              </Link>
              <Link href="/v2" className="transition hover:text-ink">
                v2
              </Link>
              <a
                href="https://github.com/olioli9586/dealscout"
                className="transition hover:text-ink"
              >
                GitHub
              </a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="mt-auto border-t border-edge bg-surface">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4 text-xs text-soft">
            <span>DealScout — live web-research demo</span>
            <a
              href="https://github.com/olioli9586/dealscout"
              className="transition hover:text-ink"
            >
              View source
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
