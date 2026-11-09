import { Scanner } from "@/components/fuzzy/scanner";

export default function Home() {
  return (
    <main className="page stack" style={{ gap: 40 }}>
      <section className="stack" style={{ gap: 14, maxWidth: 760 }}>
        <p className="mono" style={{ color: "var(--teal)", fontSize: 14 }}>Security fuzzing for Solana programs</p>
        <h1>We break it so they can&apos;t.</h1>
        <p className="quiet" style={{ fontSize: 18 }}>
          Security tools for Solana either need you to write the attacks yourself, or hand you a long list of possible bugs that are mostly false alarms. Fuzzy attacks your program in a local copy of Solana and reports only what it actually broke, with the transaction to prove it.
        </p>
      </section>
      <Scanner />
      <section className="stack" style={{ gap: 16 }}>
        <h2>How a run works</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <div className="panel stack" style={{ gap: 8 }}>
            <h3>It learns the program</h3>
            <p className="quiet" style={{ fontSize: 15 }}>From the IDL, Fuzzy builds accounts and calls every instruction the way an honest user would, so it knows which paths work.</p>
          </div>
          <div className="panel stack" style={{ gap: 8 }}>
            <h3>It attacks each path</h3>
            <p className="quiet" style={{ fontSize: 15 }}>It drops required signatures, re-runs setup as a stranger, swaps in look-alike accounts and pushes arguments to their limits.</p>
          </div>
          <div className="panel stack" style={{ gap: 8 }}>
            <h3>It keeps only proof</h3>
            <p className="quiet" style={{ fontSize: 15 }}>A finding counts only if the attack transaction succeeds and moves funds to the attacker or hands them an authority. <a href="/method">How scoring works</a></p>
          </div>
        </div>
      </section>
    </main>
  );
}
