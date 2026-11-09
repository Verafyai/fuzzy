import type { Metadata } from "next";
import { CertLookup } from "@/components/fuzzy/cert-lookup";
import record from "@/data/certify-devnet.json";
import registry from "@/data/registry.json";
import { Registry, type RegistryRow } from "@/components/fuzzy/registry";

export const metadata: Metadata = {
  title: "Registry and certifications | Fuzzy",
  description: "The Fuzzy registry of scanned Solana programs and their on-chain Verafy Certifications. Agents look a program up here before they use it.",
};

const LEVELS = [
  ["1", "Sniffed", "Survived a Sniff run with no proven findings."],
  ["2", "Fuzzed", "Survived a Deep Fuzz run on cloned mainnet state with no proven findings."],
  ["3", "Hardened", "Survived a Kitchen Sink run with no proven findings and a Fuzzy Score of 90 or more."],
];

export default function CertificationsPage() {
  const rows = (registry.programs as RegistryRow[]).filter(Boolean);
  const scanned = rows.filter((r) => r.status === "scanned");
  const proven = scanned.filter((r) => (r.proven ?? 0) > 0).length;
  const withIdl = scanned.filter((r) => r.idl).length;
  const replayed = scanned.filter((r) => r.state === "mainnet").length;
  const certified = rows.filter((r) => r.devnetCertification).length;
  const date = new Date(registry.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <main className="page stack" style={{ gap: 36, maxWidth: 920 }}>
      <section className="stack" style={{ gap: 12 }}>
        <p className="mono" style={{ color: "var(--teal)", fontSize: 14 }}>Registry and certifications</p>
        <h1>Look a program up before you use it</h1>
        <p className="quiet" style={{ fontSize: 17 }}>
          Agents now call Solana programs they have never seen, and the only signals they get were made for people: a name, a website, an audit PDF that may describe a different build. Fuzzy keeps two records an agent can read instead. The registry lists every program Fuzzy has scanned and how it scored. A Verafy Certification goes further: a jury of registered Verafy harnesses reads a Fuzzy report, rules which level the program earned, and the level is imprinted on Solana for that exact build.
        </p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>The registry</h2>
        <p className="quiet">
          {scanned.length} of the most-used Solana programs, scanned with a Fuzzy Sniff run on {date}. {proven === 0 ? "No run proved an exploit." : `${proven} ${proven === 1 ? "run" : "runs"} proved an exploit; details are withheld while the program teams are told.`} {certified} have a devnet certification only: the programs whose runs reached Depth 40 or more were put to a jury on Solana devnet. Those jurors voted by script, and a Sniff run can earn Sniffed at most, so these are not full certifications. Click any program for its full report card.
        </p>
        <Registry rows={rows} />
        <p className="muted" style={{ fontSize: 13 }}>
          Programs are listed in the order <a href="https://orbmarkets.io/programs">Orb&apos;s program directory</a> showed them on {date}, with SPL Token and Token-2022 in place of two native built-ins Fuzzy cannot load.
        </p>
        <h3 style={{ marginTop: 8 }}>Why most scores are low</h3>
        <p className="quiet">
          A low score here means a shallow run, not a broken program. Fuzzy learns a program from its Anchor IDL or by replaying its recent mainnet calls. Only {withIdl} of these programs publish an IDL on chain, and only {replayed} had recent calls Fuzzy could replay on cloned mainnet state through a public RPC. Without either, Fuzzy can&apos;t tell what the instructions are, so it tries little and Depth stays low. That is the honest result, and it is what the next engine version is for.
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
          <li><strong>Registry:</strong> <code>GET https://fuzzy.verafy.ai/api/registry?program=&lt;address&gt;</code> returns the latest scan: score, depth, proven count, leads and the bytecode hash it covers.</li>
          <li><strong>Certification over HTTP:</strong> <code>GET https://fuzzy.verafy.ai/api/certification?program=&lt;address&gt;</code> returns <code>certified</code>, the level, the score and the ruling.</li>
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
