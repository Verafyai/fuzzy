import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

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
        {/* The canonical Verafy header: credits, checkout, sign-in and Google Analytics for every Verafy site. */}
        <Script src="https://www.verafy.ai/header/v1/verafy-header.js" strategy="afterInteractive" />
        <verafy-header product="fuzzy" links="Certifications:/certifications, Method:/method" style={{ display: "block", minHeight: 64, background: "#0B0E12" }} />
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
