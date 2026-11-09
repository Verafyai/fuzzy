import type { Metadata } from "next";
import { FuzzyReport } from "@/components/fuzzy/report";
import example from "@/data/example-report.json";

export const metadata: Metadata = {
  title: "Example report | Fuzzy",
  description: "A real Fuzzy Sniff run on a benchmark Solana program with two deliberate bugs.",
};

export default function ExamplePage() {
  return (
    <main className="page">
      <FuzzyReport report={example} example />
    </main>
  );
}
