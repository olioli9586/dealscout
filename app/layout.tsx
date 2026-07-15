import type { Metadata } from "next";
import Link from "next/link";
import {
  Bricolage_Grotesque,
  IBM_Plex_Mono,
  Public_Sans,
} from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
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
