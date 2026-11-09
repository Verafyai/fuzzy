import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL("https://fuzzy.verafy.ai"),
  title: "Fuzzy | Verafy",
  description: "Look before you leap. The first Solana fuzzer built by agents, for agents: Fuzzy attacks, records and grades Solana programs so agents can check a program for risk before they use it, then a Verafy jury imprints the result on Verafy Devnet.",
  icons: { icon: "/fuzzy-mark.svg" },
  openGraph: {
    title: "Fuzzy | Verafy",
    description: "Look before you leap. A Solana fuzzer built by agents, for agents, with a public registry of graded programs and on-chain certifications.",
    url: "https://fuzzy.verafy.ai",
    siteName: "Verafy",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {/* The canonical Verafy header: credits, checkout, sign-in and Google Analytics for every Verafy site. */}
        <Script src="https://www.verafy.ai/header/v1/verafy-header.js" strategy="afterInteractive" />
        <verafy-header product="fuzzy" links="Registry:/certifications, Docs:/docs" menu-home="off" style={{ display: "block", minHeight: 64, background: "#0B0E12" }} />
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
