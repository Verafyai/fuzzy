import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Method | Fuzzy",
  description: "How Fuzzy attacks a Solana program and how the Fuzzy Score is calculated.",
};

const CEILINGS = [
  ["Critical", "Anyone can steal or permanently lock funds, or seize an authority", "20"],
  ["High", "Funds at risk under realistic conditions, or access control bypassed", "45"],
  ["Medium", "An invariant breaks without direct loss", "70"],
  ["Low", "Hygiene, such as a dependency with a published advisory", "90"],
  ["None proven", "", "100"],
];

const PARTS = [
  ["Branch coverage", "40", "Share of the program's branches executed. Not measured by this engine version yet, so it scores 0."],
  ["Instruction coverage", "20", "Share of instructions driven to both success and failure."],
  ["Attack classes tried", "20", "Share of the attack classes that apply to this program that Fuzzy actually ran."],
  ["Real state", "10", "Cloned mainnet accounts 10, synthetic accounts from the IDL 5, empty accounts 0."],
  ["Effort", "10", "Share of the planned run completed within the time limit."],
];

export default function MethodPage() {
  return (
    <main className="page stack" style={{ gap: 32, maxWidth: 860 }}>
      <section className="stack" style={{ gap: 12 }}>
        <h1>How Fuzzy works</h1>
        <p className="quiet" style={{ fontSize: 17 }}>
          Checking a Solana program has meant separate tools run by a person: confirm the deployed build, run a static scanner, write a fuzz harness, test against real state, then commission an audit. Fuzzy runs the parts a machine can prove as one automated pass. It attacks the program in LiteSVM, a local copy of Solana, keeps only the attacks that work, grades the run, and can send the result to a Verafy jury that imprints a certification on <a href="https://devnet.verafy.ai">Verafy Devnet</a>.
        </p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>What a Sniff run does</h2>
        <ul className="list quiet">
          <li>Reads the program&apos;s Anchor IDL and builds the accounts it expects, funded as if users had deposited.</li>
          <li>Calls every instruction as an honest owner would, to learn which paths work and in what order.</li>
          <li>For a deployed program, replays its recent mainnet calls on cloned copies of the accounts they touched, then attacks those calls too. This works without an IDL.</li>
          <li>Attacks each working path: drops each required signature, re-runs setup as a stranger, swaps in a look-alike account owned by another program, and sends extreme arguments.</li>
          <li>Keeps a finding only if the attack transaction succeeds and moves funds to the attacker or writes the attacker in as an authority. Everything else is a lead: shown, never scored.</li>
          <li>Never sends anything to mainnet or devnet. Fetching a deployed program is a read.</li>
        </ul>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>The Fuzzy Score</h2>
        <p className="quiet">The score is the lower of two numbers: Depth, which says how hard Fuzzy tried, and a cap set by the worst proven finding. A shallow run can&apos;t score high because it found nothing, and a deep run can&apos;t score high with a critical bug.</p>
        <table className="data">
          <thead><tr><th>Worst proven finding</th><th>Meaning</th><th style={{ textAlign: "right" }}>Cap</th></tr></thead>
          <tbody>{CEILINGS.map(([s, m, c]) => <tr key={s}><td>{s}</td><td className="quiet">{m}</td><td className="mono" style={{ textAlign: "right" }}>{c}</td></tr>)}</tbody>
        </table>
        <table className="data">
          <thead><tr><th>Depth part</th><th style={{ textAlign: "right" }}>Weight</th><th>Measured as</th></tr></thead>
          <tbody>{PARTS.map(([p, w, m]) => <tr key={p}><td>{p}</td><td className="mono" style={{ textAlign: "right" }}>{w}</td><td className="quiet">{m}</td></tr>)}</tbody>
        </table>
        <p className="quiet">Grades: 90 and up is Hardened, 75 Solid, 50 Shaky, 25 Exposed, and below 25 Broken. Scores are versioned as fuzzy-score/1 and tied to one exact build of the program.</p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>What this version does not do yet</h2>
        <ul className="list quiet">
          <li>Branch coverage and model-planned attacks arrive with Deep Fuzz. Until then, the highest possible score is 60 with mainnet replay and 55 without.</li>
          <li>Programs with no IDL and no recent calls Fuzzy can replay get only a shallow run, because Fuzzy can&apos;t tell what their instructions are.</li>
          <li>Token-account, CPI and PDA attack classes are listed as not tried when they apply.</li>
        </ul>
      </section>
    </main>
  );
}
