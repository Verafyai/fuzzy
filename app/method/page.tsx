import type { Metadata } from "next";
import { ASSESSMENTS, BUILT_ON, NOT_RUN } from "@/lib/assessments";

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

      <section className="stack" style={{ gap: 14 }}>
        <h2>Every step, in detail</h2>
        <h3>1. Ingest</h3>
        <ul className="list quiet">
          <li>Reads the program account with <code>getAccountInfo</code>. For the upgradeable loader it follows the pointer to the program data account, reads the upgrade authority, and strips the 45-byte header. Loader v2 programs are read as is.</li>
          <li>Parses the ELF (machine type, text size, SBF instruction count) and hashes it with SHA-256. Every result is tied to that hash.</li>
          <li>Looks for an Anchor IDL on chain, at <code>createWithSeed(findProgramAddress([], program), &quot;anchor:idl&quot;, program)</code>, and inflates it. With an IDL, Fuzzy knows every instruction&apos;s accounts, signers, PDAs and argument types.</li>
        </ul>
        <h3>2. Learn</h3>
        <ul className="list quiet">
          <li>Builds a world in LiteSVM: the program, an owner, a stranger and an attacker, each funded with 10 SOL, plus the state accounts and PDAs the IDL describes.</li>
          <li>Signers are derived from <code>sha256(&quot;fuzzy:&quot; + seed + &quot;:&quot; + label)</code>, so a run with the same seed is the same run, and any finding replays exactly.</li>
          <li>Calls every instruction as an honest owner, with typical arguments, to find the paths that complete and the order they need (for example, initialize before deposit before withdraw).</li>
        </ul>
        <h3>3. Replay</h3>
        <ul className="list quiet">
          <li>For a deployed program, fetches up to 60 recent signatures with <code>getSignaturesForAddress</code> and up to 10 successful calls with <code>getTransaction</code>.</li>
          <li>Clones every account those calls touched, and every other program they invoked, into LiteSVM at the slot they ran.</li>
          <li>Replays each call honestly first. Signature checks are off so the original signers can be stood in for, which is why the next rule exists: in an attack, every remaining signer becomes the attacker, and a finding that relies on a signature the attacker does not hold is thrown out.</li>
          <li>Replay works without an IDL, which is how Fuzzy tests programs that publish none.</li>
        </ul>
        <h3>4. Attack</h3>
        <p className="quiet">From every path that completed, Fuzzy runs each attack class that applies. A class applies when the interface has something it can target, such as a signer, a numeric argument, a state account or an instruction named close.</p>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Class</th><th>The attack</th><th>Counts as proof when</th><th>Status</th></tr></thead>
            <tbody>{ASSESSMENTS.map((a) => <tr key={a.id}><td>{a.name}</td><td className="quiet" style={{ fontSize: 13 }}>{a.how}</td><td className="quiet" style={{ fontSize: 13 }}>{a.proof || "Not built yet."}</td><td className="status" style={{ color: a.built ? "var(--teal)" : "var(--medium)" }}>{a.built ? "runs today" : "planned"}</td></tr>)}</tbody>
          </table>
        </div>
        <h3>5. Prove</h3>
        <ul className="list quiet">
          <li>Measures every account&apos;s SOL before and after each attack. Transaction fees paid by the attacker are not counted as loss.</li>
          <li>A finding needs the attack transaction to succeed and either SOL to reach an account the attacker controls, or the attacker&apos;s key to replace the owner&apos;s in program state. The transaction, its logs, the compute it used and the balance changes are kept as evidence.</li>
          <li>Anything else that changed program state without permission, or made the program panic, is a lead: shown, never scored.</li>
        </ul>
        <h3>6. Grade</h3>
        <p className="quiet">The Fuzzy Score, below. A Sniff run has a budget of 600 transactions and 40 seconds; replay gets half of each when there is history.</p>
        <h3>7. Jury and 8. Imprint</h3>
        <p className="quiet">The report is hashed as canonical JSON and sent to a jury of registered Verafy harnesses on <a href="https://devnet.verafy.ai">Verafy Devnet</a>. The verafy_certification program writes the level only if the ruling is sealed, its contract hash binds this program, bytecode hash, report hash and score, and every seat is an active registered harness, with at least three seats from at least two model families. <a href="/certifications">Certifications</a></p>
        <h3>Built on</h3>
        <ul className="list quiet">{BUILT_ON.map((b) => <li key={b.href}><a href={b.href}>{b.label}</a></li>)}</ul>
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
        <h2>Checks Fuzzy does not run</h2>
        <ul className="list quiet">{NOT_RUN.map((n) => <li key={n.name}><strong>{n.name}:</strong> {n.why} <a href={n.source.href}>{n.source.label}</a></li>)}</ul>
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
