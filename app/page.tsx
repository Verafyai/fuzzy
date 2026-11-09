import { Scanner } from "@/components/fuzzy/scanner";

const WAYS = [
  ["Look it up", "Free, instant", "/certifications", "Open the registry", "If Fuzzy has already scanned or certified this exact build, the agent has its answer without running anything."],
  ["Run Fuzzy first", "100 credits, under a minute", "#scan", "Scan above", "For a program nobody has scanned, or a build that changed. The result goes into the registry for the next agent."],
  ["Get it certified", "A jury ruling on Verafy Devnet", "/certifications", "See certifications", "A jury of AI models checks the run, and the level is written on chain for that exact build."],
];

export default function Home() {
  return (
    <main className="page stack" style={{ gap: 48 }}>
      <section id="scan" className="stack" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 10, maxWidth: 820 }}>
          <p className="row mono" style={{ gap: 10, color: "var(--teal)", fontSize: 14 }}>
            <span>Fuzzy by Verafy</span>
            <span className="pill">Prototype</span>
          </p>
          <h1>Look before you leap.</h1>
          <p style={{ fontSize: 20, lineHeight: 1.4, color: "var(--text)" }}>The first Solana fuzzer built by agents, for agents.</p>
          <p className="quiet" style={{ fontSize: 16 }}>
            With the <a href="/docs#mcp">Fuzzy MCP server</a>, agents can pre-check which Solana programs have been evaluated and survived Fuzzy&apos;s attacks, or opt in to running a comprehensive check in advance.
          </p>
        </div>
        <Scanner />
      </section>

      <section className="stack" style={{ gap: 16 }}>
        <h2>Three ways an agent uses Fuzzy</h2>
        <div className="grid3">
          {WAYS.map(([t, m, href, cta, d]) => (
            <div key={t} className="panel stack" style={{ gap: 8 }}>
              <h3>{t}</h3>
              <span className="mono muted" style={{ fontSize: 13 }}>{m}</span>
              <p className="quiet" style={{ fontSize: 15, flex: 1 }}>{d}</p>
              <a href={href} style={{ fontSize: 15 }}>{cta}</a>
            </div>
          ))}
        </div>
      </section>

      <p className="muted" style={{ fontSize: 14, maxWidth: 820 }}>
        Fuzzy is a prototype. Certifications live on <a href="https://devnet.verafy.ai">Verafy Devnet</a> for now and will move to <a href="https://chain.verafy.ai">Verafy Chain</a> when it is ready.
      </p>
    </main>
  );
}
