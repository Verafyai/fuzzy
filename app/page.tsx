import { Scanner } from "@/components/fuzzy/scanner";
import registry from "@/data/registry.json";

const DEVNET = "https://devnet.verafy.ai";
const CERT_PROGRAM = "1dcJPW3aGMCWDkNV6do6sEUwSxLdf8NtSuQb1teCdXt";
const explorer = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

const WAYS = [
  ["Look it up", "Free, instant", "Check the registry or the certification account before calling a program. If Fuzzy has already scanned or certified this exact build, the agent has its answer without running anything."],
  ["Run Fuzzy first", "100 credits, about a minute", "For a program nobody has scanned, or a build that changed, the agent runs Fuzzy on it before it sends money through it. The result goes into the registry for the next agent."],
  ["Get it certified", "A jury ruling on Verafy Devnet", "A jury of AI models checks the run and rules on a level. The level is imprinted on chain for that exact build, so any agent can read it with one call."],
];

const STEPS = [
  ["Confirm the exact build", "Verifiable builds, by hand", "Fetches the deployed bytecode, hashes it, reads the upgrade authority. Every result is tied to that hash."],
  ["Look for known bug patterns", "Static scanners and linters", "Targets the same patterns (missing signer, wrong account owner, re-initialization, extreme arguments), but must prove each one with a transaction."],
  ["Write the attacks", "A hand-written fuzz harness", "Generates the attacks from the program's IDL. No harness to write."],
  ["Test against real state", "Manual mainnet forks", "Replays the program's recent mainnet calls on cloned copies of the accounts they touched."],
  ["Get a verdict others trust", "An audit report", "Grades the run with the Fuzzy Score, then an AI jury checks it and the result is imprinted on Verafy Devnet."],
];

const PIPELINE = [
  ["Ingest", "Exact bytecode, hash, IDL, upgrade authority"],
  ["Learn", "Calls every instruction as an honest user"],
  ["Replay", "Recent mainnet calls on cloned accounts"],
  ["Attack", "Seven attack classes on every working path"],
  ["Prove", "Keeps only attacks that steal or seize"],
  ["Grade", "Fuzzy Score: depth against the worst bug"],
  ["Jury", "AI models from different labs check the run"],
  ["Imprint", "The level is written on Verafy Devnet"],
];

type Row = { status: string; proven?: number; leads?: number };

export default function Home() {
  const rows = (registry.programs as Row[]).filter(Boolean);
  const scanned = rows.filter((r) => r.status === "scanned").length;
  return (
    <main className="page stack" style={{ gap: 56 }}>
      <section className="stack" style={{ gap: 16, maxWidth: 820 }}>
        <p className="row mono" style={{ gap: 10, color: "var(--teal)", fontSize: 14 }}>
          <span>Fuzzy by Verafy</span>
          <span className="pill">Prototype</span>
        </p>
        <h1>Look before you leap.</h1>
        <p style={{ fontSize: 22, lineHeight: 1.4, color: "var(--text)" }}>
          The first Solana fuzzer built by agents, for agents. Fuzzy attacks, records and grades Solana programs so an agent can check a program for risk before it trusts it with money.
        </p>
        <p className="quiet" style={{ fontSize: 17 }}>
          Agents now hold wallets and call Solana programs on their own, often programs they have never seen. Until now the only signals were made for people: a website, a Discord, an audit PDF that may describe a different build. Fuzzy is a look-ahead for agents. It keeps a running, public grade for each program, flags vulnerabilities in advance, and lets an agent check a program in one call before it uses it.
        </p>
      </section>

      <section className="stack" style={{ gap: 16 }}>
        <h2>Three ways an agent uses Fuzzy</h2>
        <div className="grid3">
          {WAYS.map(([t, m, d], i) => (
            <div key={t} className="panel stack" style={{ gap: 8 }}>
              <span className="mono" style={{ color: "var(--teal)", fontSize: 13 }}>{i + 1}</span>
              <h3>{t}</h3>
              <span className="mono muted" style={{ fontSize: 13 }}>{m}</span>
              <p className="quiet" style={{ fontSize: 15 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: 14 }}>
        <h2>Scan a program</h2>
        <Scanner />
      </section>

      <section className="stack" style={{ gap: 16 }}>
        <h2>One pass instead of five</h2>
        <p className="quiet" style={{ fontSize: 17, maxWidth: 820 }}>
          Evaluating a Solana program has meant a handful of separate tools and steps, each run by a person who then has to put the results together. Fuzzy runs the parts a machine can prove in a single automated pass, in sequence, and writes down the result.
        </p>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Step</th><th>Usually done with</th><th>In Fuzzy</th></tr></thead>
            <tbody>{STEPS.map(([s, u, f]) => <tr key={s}><td>{s}</td><td className="muted">{u}</td><td className="quiet">{f}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>Fuzzy does not replace a human audit of the program&apos;s design and economics. It checks what can be proven by running transactions.</p>
      </section>

      <section className="stack" style={{ gap: 16 }}>
        <h2>From scan to certificate</h2>
        <ol className="pipeline">
          {PIPELINE.map(([t, d], i) => (
            <li key={t} data-chain={i >= 6 ? "true" : undefined}>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{i + 1}</span>
              <b>{t}</b>
              <span>{d}</span>
            </li>
          ))}
        </ol>
        <p className="muted" style={{ fontSize: 14 }}>Steps 1 to 6 run in Fuzzy. Steps 7 and 8 run on Verafy Devnet.</p>
      </section>

      <section className="panel stack" style={{ gap: 12 }}>
        <h2>Graded by an AI jury, recorded on Verafy Devnet</h2>
        <p className="quiet" style={{ fontSize: 16 }}>
          <a href={DEVNET}>Verafy Devnet</a> is where Verafy&apos;s programs run on Solana devnet: juries of AI models from different labs, each running in a registered Verafy Harness, rule on questions and seal their rulings on chain. You can watch every ruling and every vote there.
        </p>
        <p className="quiet" style={{ fontSize: 16 }}>
          Fuzzy sends the jury its report, hashed. The jurors check the run against the level rules and rule a level: Not certified, Sniffed, Fuzzed or Hardened. The <a href={explorer(CERT_PROGRAM)}>verafy_certification program</a> then imprints that level on Solana devnet for the program&apos;s exact bytecode. It refuses unless a sealed ruling backs it, with at least three registered jurors from at least two model families, so no one can certify their own program.
        </p>
        <p className="quiet" style={{ fontSize: 16 }}>
          The first certification is live on devnet for Fuzzy&apos;s benchmark vault. The jurors in that run voted by script; real model jurors are next. <a href="/certifications">Check it</a>, or see <a href={`${DEVNET}/about/`}>what is live and what is scripted on Verafy Devnet</a>.
        </p>
      </section>

      <section className="row" style={{ justifyContent: "space-between", gap: 16, borderTop: "1px solid var(--border)", paddingTop: 28 }}>
        <div className="stack" style={{ gap: 6, flex: "1 1 460px" }}>
          <h2>The registry</h2>
          <p className="quiet" style={{ fontSize: 15 }}>
            {scanned} of the most-used Solana programs, scanned and graded, with more added as agents run Fuzzy. An agent can look a program up here before it calls it.
          </p>
        </div>
        <a className="btn btn-quiet" href="/certifications">See the list</a>
      </section>

      <section className="stack" style={{ gap: 8, maxWidth: 820 }}>
        <h2>A prototype, for now</h2>
        <p className="quiet" style={{ fontSize: 16 }}>
          Fuzzy is a prototype. Certifications live on Verafy Devnet, not mainnet, and no score from this engine version can go above 60, because it does not yet measure branch coverage. When <a href="https://chain.verafy.ai">Verafy Chain</a> is ready for prime time, we plan to move certifications there.
        </p>
      </section>
    </main>
  );
}
