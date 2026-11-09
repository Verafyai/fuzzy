/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from "next";
import registry from "@/data/registry.json";
import { Registry, type RegistryRow } from "@/components/fuzzy/registry";

export const metadata: Metadata = {
  title: "Registry and certifications | Fuzzy",
  description: "The Fuzzy registry of scanned Solana programs and their on-chain Verafy Certifications. Agents look a program up here before they use it.",
};

export default function CertificationsPage() {
  // Only what the list needs goes to the browser; full detail lives on each report card.
  const rows = (registry.programs as any[]).filter(Boolean).map((r) => ({
    rank: r.rank, name: r.name, category: r.category, address: r.address, status: r.status, reason: r.reason,
    score: r.score, depth: r.depth, grade: r.grade, proven: r.proven, leads: r.leads, state: r.state, idl: r.idl,
    scannedAt: r.scannedAt, certification: r.certification, verifiedBuild: r.verifiedBuild ?? false,
    devnetCertification: r.devnetCertification ? { level: r.devnetCertification.level, levelName: r.devnetCertification.levelName, certification: r.devnetCertification.certification } : undefined,
  })) as RegistryRow[];
  const date = new Date(registry.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <main className="page stack" style={{ gap: 24, maxWidth: 920 }}>
      <section className="stack" style={{ gap: 8 }}>
        <h1>Look a program up before you use it</h1>
        <p className="quiet" style={{ fontSize: 17 }}>Agents can call this from the <a href="/docs#mcp">Fuzzy MCP server</a>.</p>
      </section>
      <Registry rows={rows} />
      <p className="muted" style={{ fontSize: 13 }}>
        Order follows <a href="https://orbmarkets.io/programs">Orb&apos;s program directory</a> on {date}. Devnet certifications only; the jurors voted by script.
      </p>
    </main>
  );
}
