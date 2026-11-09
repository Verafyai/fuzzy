import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Inter } from "next/font/google";
import { ProductHeader } from "@/components/verafy-header/product-header";
import { FUZZY_LINKS } from "@/components/verafy-header/links";
import { gaInlineSnippet, gaMeasurementIds, gaScriptSrc } from "@/lib/ga-measurement-ids";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const GA_IDS = gaMeasurementIds(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID);
const GA_SRC = gaScriptSrc(GA_IDS);
const GA_SNIPPET = gaInlineSnippet(GA_IDS);

export const metadata: Metadata = {
  metadataBase: new URL("https://fuzzy.verafy.ai"),
  title: "Fuzzy | Verafy",
  description: "Security fuzzing for Solana programs. Fuzzy attacks your program in a local copy of Solana and reports only what it actually broke, with the transaction to prove it.",
  icons: { icon: "/fuzzy-mark.svg" },
  openGraph: {
    title: "Fuzzy | Verafy",
    description: "We break it so they can't. Security fuzzing for Solana programs, with every finding proven by a real transaction.",
    url: "https://fuzzy.verafy.ai",
    siteName: "Verafy",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {process.env.NODE_ENV === "production" && GA_SRC ? (
          <>
            <Script src={GA_SRC} strategy="afterInteractive" />
            <Script id="google-analytics" strategy="afterInteractive">
              {GA_SNIPPET}
            </Script>
          </>
        ) : null}
        <ProductHeader product="fuzzy" links={FUZZY_LINKS} />
        {children}
        <footer className="page" style={{ paddingTop: 0, paddingBottom: 40 }}>
          <p className="muted" style={{ fontSize: 14, borderTop: "1px solid var(--border)", paddingTop: 20 }}>
            Fuzzy is a Verafy product. A high score means a program survived these attacks. It is not an audit and not a promise of safety.
          </p>
        </footer>
      </body>
    </html>
  );
}
