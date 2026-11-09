import type { Metadata } from "next";
import { CertLookup } from "@/components/fuzzy/cert-lookup";
import record from "@/data/certify-devnet.json";

export const metadata: Metadata = {
  title: "Verafy Certification | Fuzzy",
  description: "On-chain report cards for Solana programs. Agents check one account to decide whether to trust a program.",
};

const LEVELS = [
  ["1", "Sniffed", "Survived a Sniff run with no proven findings."],
  ["2", "Fuzzed", "Survived a Deep Fuzz run on cloned mainnet state with no proven findings."],
  ["3", "Hardened", "Survived a Kitchen Sink run with no proven findings and a Fuzzy Score of 90 or more."],
];

export default function CertificationsPage() {
  return (
    <main className="page stack" style={{ gap: 36, maxWidth: 920 }}>
      <section className="stack" style={{ gap: 12 }}>
        <p className="mono" style={{ color: "var(--teal)", fontSize: 14 }}>Verafy Certification</p>
        <h1>A report card on chain, for every build</h1>
        <p className="quiet" style={{ fontSize: 17 }}>
          Agents now call Solana programs they have never seen, and the only signal they get is reputation: a name, a website, an audit PDF that may describe a different build. A Verafy Certification is a machine-checkable answer. A jury of registered Verafy harnesses reads a Fuzzy report and rules which level the program earned. The level is written on Solana for that exact build, and only a sealed jury ruling can write it.
        </p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>Check a program</h2>
        <CertLookup initial={record.program} />
        <p className="muted" style={{ fontSize: 14 }}>Prefilled with the first certification: Fuzzy&apos;s benchmark vault (fixed build) on devnet, ruled by four registered harnesses from four model families. Their votes were scripted for this first run.</p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>Levels</h2>
        <table className="data">
          <thead><tr><th>Level</th><th>Name</th><th>The report must show</th></tr></thead>
          <tbody>{LEVELS.map(([l, n, m]) => <tr key={l}><td className="mono">{l}</td><td>{n}</td><td className="quiet">{m}</td></tr>)}</tbody>
        </table>
        <p className="quiet">Any proven finding means level 0, not certified. When the jury is unsure between two levels, it picks the lower. A certification says the build survived these attacks. It is not an audit.</p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>How an agent checks</h2>
        <ul className="list quiet">
          <li><strong>HTTP:</strong> <code>GET https://fuzzy.verafy.ai/api/certification?program=&lt;address&gt;</code> returns <code>certified</code>, the level, the score and the ruling.</li>
          <li><strong>MCP:</strong> the Verafy Harness MCP server has the tool <code>verafy_certification</code>.</li>
          <li><strong>Directly on Solana:</strong> hash the program&apos;s current bytecode (the ELF the loader runs, without padding), then read the account at <code>[&quot;cert&quot;, program, bytecode hash]</code> under <code>1dcJPW3aGMCWDkNV6do6sEUwSxLdf8NtSuQb1teCdXt</code>. No account means no certification for this build.</li>
        </ul>
        <p className="quiet">An upgrade changes the bytecode hash, so an upgraded program reads as uncertified until it is certified again. Treat &quot;not certified&quot; as &quot;not vouched for&quot;, not as malicious.</p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>Who can change the rules</h2>
        <p className="quiet">Fuzzy&apos;s rules are a charter with protected articles: only proven findings count, a certification names one exact build, only a jury certifies, nothing already issued changes. Anyone can propose an amendment; a Verafy jury adopts it only if every protected article still holds. <a href="https://github.com/Verafyai/fuzzy/tree/main/governance">Read the charter</a>.</p>
      </section>
    </main>
  );
}
