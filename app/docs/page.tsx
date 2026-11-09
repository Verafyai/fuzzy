import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docs | Fuzzy",
  description: "Use Fuzzy from an agent: the Fuzzy MCP server, the HTTP API, the CLI and the on-chain certification lookup.",
};

const MCP_URL = "https://fuzzy.verafy.ai/api/mcp";
const GITHUB = "https://github.com/Verafyai/fuzzy";

const TOOLS = [
  ["fuzzy_lookup", "program", "The latest scan of a program from the registry: score, grade, depth, proven, leads, tested on, scanned at, devnet certification, report card link."],
  ["fuzzy_certification", "program", "Reads the Verafy Certification for the exact deployed build, from Solana devnet."],
  ["fuzzy_registry_search", "query, category, minScore, certifiedOnly", "Searches the registry. Up to 25 results."],
  ["fuzzy_scan_instructions", "program", "How to scan a program that is not in the registry: the web link with the address filled in, the cost, and the CLI command."],
];

const EVENTS = [
  ["charged", "Credits were spent. Carries the new balance, or mock: true when credits are not connected."],
  ["note", "A line of progress text."],
  ["progress", "Transactions sent so far."],
  ["finding", "A proven finding, with the attack transaction."],
  ["report", "The full report. Always the last event of a successful run."],
  ["error", "The run failed and the credits were returned."],
];

export default function DocsPage() {
  return (
    <main className="page stack" style={{ gap: 36, maxWidth: 900 }}>
      <section className="stack" style={{ gap: 12 }}>
        <p className="mono" style={{ color: "var(--teal)", fontSize: 14 }}>Docs</p>
        <h1>Use Fuzzy from an agent</h1>
        <p className="quiet" style={{ fontSize: 17 }}>
          An agent that is about to send money through a Solana program can check it three ways: look it up in the registry, run Fuzzy on it, or read its certification. Each works over MCP, over HTTP, and the last one directly on Solana. Everything here is free except a new scan.
        </p>
        <div className="row" style={{ gap: 10 }}>
          <a className="btn btn-primary" href="#mcp">Add the MCP server</a>
          <a className="btn btn-quiet" href="/fuzzy-mcp.json" download>Download MCP config</a>
          <a className="btn btn-quiet" href={GITHUB}>GitHub</a>
        </div>
      </section>

      <section id="mcp" className="stack" style={{ gap: 12 }}>
        <h2>The Fuzzy MCP server</h2>
        <p className="quiet">A remote MCP server over Streamable HTTP. No key, no install, read only.</p>
        <pre className="code">{MCP_URL}</pre>
        <h3>Claude Code</h3>
        <pre className="code">{`claude mcp add --transport http fuzzy ${MCP_URL}`}</pre>
        <h3>Claude Desktop, Cursor, Windsurf and other clients</h3>
        <p className="quiet">Add this to the client&apos;s MCP config, or <a href="/fuzzy-mcp.json" download>download it</a>:</p>
        <pre className="code">{`{
  "mcpServers": {
    "fuzzy": { "type": "http", "url": "${MCP_URL}" }
  }
}`}</pre>
        <p className="quiet">For a client that only runs local servers, bridge it with mcp-remote:</p>
        <pre className="code">{`{
  "mcpServers": {
    "fuzzy": { "command": "npx", "args": ["-y", "mcp-remote", "${MCP_URL}"] }
  }
}`}</pre>
        <h3>Tools</h3>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Tool</th><th>Arguments</th><th>Returns</th></tr></thead>
            <tbody>{TOOLS.map(([t, a, d]) => <tr key={t}><td className="mono">{t}</td><td className="mono muted" style={{ fontSize: 13 }}>{a}</td><td className="quiet" style={{ fontSize: 14 }}>{d}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="quiet">A good rule for an agent: before sending funds through an unfamiliar program, call <code>fuzzy_lookup</code>. Treat a program that is not in the registry, or has a proven finding, as unvetted, and keep amounts small until it is scanned.</p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>HTTP API</h2>
        <p className="quiet">Open to any origin. JSON.</p>
        <h3>Look a program up</h3>
        <pre className="code">{`GET https://fuzzy.verafy.ai/api/registry?program=<address>
GET https://fuzzy.verafy.ai/api/registry            # the whole registry`}</pre>
        <p className="quiet">Returns the latest scan: <code>score</code>, <code>grade</code>, <code>depth</code>, <code>depthParts</code>, <code>proven</code>, <code>leads</code>, <code>state</code> (mainnet, synthetic or empty), <code>classes</code> (each attack class and whether it held), <code>instructionsTried</code>, <code>bytecodeSha256</code>, <code>scannedAt</code> and <code>devnetCertification</code>. A 404 means Fuzzy has not scanned the program.</p>
        <h3>Check a certification</h3>
        <pre className="code">{`GET https://fuzzy.verafy.ai/api/certification?program=<address>`}</pre>
        <p className="quiet">Hashes the program&apos;s deployed bytecode (devnet first, then mainnet) and reads the certification account on devnet. Returns <code>certified</code>, <code>level</code>, <code>levelName</code>, <code>score</code>, <code>seats</code>, <code>families</code>, <code>ruling</code>, <code>bytecodeHash</code>, <code>programCluster</code> and <code>reason</code>.</p>
        <h3>Run a scan</h3>
        <pre className="code">{`POST https://fuzzy.verafy.ai/api/scan
content-type: application/json

{ "address": "<program address>", "network": "mainnet", "addons": ["advisories"] }`}</pre>
        <p className="quiet">Or send <code>multipart/form-data</code> with <code>program</code> (a .so file, up to 4 MB) and optional <code>idl</code>. <code>addons</code> is optional, for mainnet programs: <code>verified</code> (+25 credits) checks for a verified build of public source; <code>advisories</code> (+100, includes <code>verified</code>) checks that build&apos;s dependencies against RustSec. Results arrive in the report&apos;s <code>addons</code> field and never change the score. <a href="/method#addons">All add-ons and prices</a>. A Sniff run costs 100 Verafy credits from the caller&apos;s balance (the <code>verafy_vid</code> cookie on .verafy.ai). The response streams newline-delimited JSON events:</p>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Event type</th><th>Meaning</th></tr></thead>
            <tbody>{EVENTS.map(([t, d]) => <tr key={t}><td className="mono">{t}</td><td className="quiet" style={{ fontSize: 14 }}>{d}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>Build machine add-ons</h2>
        <p className="quiet">Rebuild from source (500 credits), static lints (300), Deep Fuzz (1,000), property fuzzing (1,500), the AI design review (1,000), or all of them as Kitchen Sink (4,000). They run for minutes on Fuzzy&apos;s build machine, so they are jobs: start one, then poll it.</p>
        <pre className="code">{`POST https://fuzzy.verafy.ai/api/jobs
{ "address": "<mainnet program>", "jobs": ["deep", "property"], "idl": { ...optional Anchor IDL } }
-> { "id": "<job id>", "jobs": [...], "skipped": [...], "charged": 2500 }

GET https://fuzzy.verafy.ai/api/jobs/<job id>
-> { "status": "queued" | "running" | "done" | "failed", "result": { "rebuild", "lints", "deep", "property", "review" } }`}</pre>
        <p className="quiet">Checks that need source (rebuild, lints, review) run only when the program has a verified build, and you are never charged for one that cannot run. A job that fails is refunded. <code>GET /api/jobs</code> says whether the build machine is connected.</p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>Command line</h2>
        <pre className="code">{`git clone ${GITHUB} && cd fuzzy && npm install
npm run fuzzy -- run <program address>                 # a deployed program, mainnet by default
npm run fuzzy -- run <address> --network devnet --rpc <url>
npm run fuzzy -- run program.so --idl idl.json         # a local build
npm run fuzzy -- replay report.json F1 --program program.so   # re-run a finding's transaction`}</pre>
        <p className="quiet">Node 22. Every attack runs in LiteSVM on your machine; reading a deployed program is the only network call. A paid RPC in <code>--rpc</code> gives Fuzzy more recent calls to replay, and a deeper run.</p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>Read a certification on Solana</h2>
        <p className="quiet">No Fuzzy server needed. The certification program on devnet is <code>1dcJPW3aGMCWDkNV6do6sEUwSxLdf8NtSuQb1teCdXt</code>.</p>
        <ol className="list quiet">
          <li>Read the program account. For the upgradeable loader, read its program data account and skip the 45-byte header.</li>
          <li>Hash the ELF: SHA-256 of the bytes up to the end of the section header table, without trailing padding.</li>
          <li>Derive the account at seeds <code>[&quot;cert&quot;, program, bytecode hash]</code> under the certification program, and read it on devnet.</li>
          <li>No account means no certification for this build. Otherwise the account holds the level, score, report hash, ruling and jury size.</li>
        </ol>
        <p className="quiet">The <a href="https://github.com/Verafyai/verafyHarness">Verafy Harness</a> package <code>@verafyharness/solana</code> exports <code>lookupCertification</code>, which does all four.</p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2>Limits</h2>
        <ul className="list quiet">
          <li>Fuzzy is a prototype. Certifications live on Solana devnet, and devnet certifications so far had jurors voting by script.</li>
          <li>A Sniff run scores 60 at most: only Deep Fuzz measures branch coverage.</li>
          <li>Theft is measured in SOL everywhere, and in tokens during mainnet replay. Runs built from an IDL alone measure SOL only.</li>
          <li>A high score means a program survived these attacks. It is not an audit.</li>
        </ul>
        <p className="quiet"><a href="/method">How Fuzzy works, in full</a> · <a href={GITHUB}>Source on GitHub</a></p>
      </section>
    </main>
  );
}
