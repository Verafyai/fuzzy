import { FuzzyMascot, moodForGrade } from "@/components/fuzzy/mascot";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Report = any;

const SEVERITY_LABEL: Record<string, string> = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW" };
const GRADE_COLOR: Record<string, string> = { Hardened: "var(--teal)", Solid: "var(--teal)", Shaky: "var(--medium)", Exposed: "var(--high)", Broken: "var(--critical)" };
const DEPTH_PARTS: { key: string; name: string; of: number }[] = [
  { key: "branchCoverage", name: "Branch coverage", of: 40 },
  { key: "instructionCoverage", name: "Instruction coverage", of: 20 },
  { key: "attackClasses", name: "Attack classes tried", of: 20 },
  { key: "realState", name: "Real state", of: 10 },
  { key: "effort", name: "Effort", of: 10 },
];

function sol(lamports: string | number) {
  return `${(Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export function FuzzyReport({ report, example = false }: { report: Report; example?: boolean }) {
  const s = report.score;
  // A run that found nothing and got little coverage is shallow, not broken.
  const shallow = report.findings.length === 0 && s.depth < 50;
  const gradeLabel = shallow ? "Shallow run" : s.grade;
  const color = shallow ? "var(--text-3)" : GRADE_COLOR[s.grade] || "var(--teal)";
  const circumference = 2 * Math.PI * 70;
  const notes = depthNotes(report);
  return (
    <div className="stack" style={{ gap: 28 }}>
      {example ? (
        <p className="muted" style={{ fontSize: 14 }}>
          A real Sniff run on example_vault, a benchmark program Verafy wrote with two deliberate bugs. Its source is in the Fuzzy repository.
        </p>
      ) : null}

      <section className="panel row" style={{ gap: 28 }}>
        <div style={{ position: "relative", width: 168, height: 168, flex: "0 0 168px" }}>
          <svg viewBox="0 0 180 180" width="168" height="168" role="img" aria-label={`Fuzzy Score ${s.score} out of 100`}>
            <circle cx="90" cy="90" r="70" fill="none" stroke="var(--border)" strokeWidth="14" />
            <circle cx="90" cy="90" r="70" fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(s.score / 100) * circumference} ${circumference}`} transform="rotate(-90 90 90)" />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span className="mono" style={{ fontSize: 46, fontWeight: 600, color, lineHeight: 1 }}>{s.score}</span>
            <span style={{ fontWeight: 600, marginTop: 4 }}>{gradeLabel}</span>
          </div>
        </div>
        <div className="stack" style={{ flex: "999 1 360px", gap: 10 }}>
          <h1 style={{ fontSize: 30 }}>{report.program.name} scored {s.score}</h1>
          <p className="quiet" style={{ fontSize: 16 }}>{headline(report)}</p>
          <p className="mono muted" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
            {report.tier.name} · {new Date(report.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {plural(report.tested.transactions, "transaction")} · sha256 {report.program.sha256.slice(0, 12)}…
            {report.program.address ? ` · ${report.program.network} ${report.program.address}` : ""}
          </p>
        </div>
        <FuzzyMascot mood={shallow ? "sniffing" : moodForGrade(s.grade)} size={132} />
      </section>

      <section className="row" style={{ alignItems: "stretch", gap: 20 }}>
        <div className="panel stack" style={{ flex: "1 1 460px" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Depth {s.depth} of 100</h2>
            <span className="muted" style={{ fontSize: 13 }}>How hard Fuzzy tried</span>
          </div>
          {DEPTH_PARTS.map((p) => (
            <div key={p.key} className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 14 }}>
                <span>{p.name}</span>
                <span className="mono muted">{s.depthParts[p.key]} / {p.of}</span>
              </div>
              <div className="bar"><span style={{ width: `${(s.depthParts[p.key] / p.of) * 100}%` }} /></div>
              {notes[p.key] ? <span className="muted" style={{ fontSize: 12 }}>{notes[p.key]}</span> : null}
            </div>
          ))}
        </div>
        <div className="panel stack" style={{ flex: "1 1 320px" }}>
          <h2>What sets the cap</h2>
          {(["critical", "high", "medium", "low"] as const).map((sev) => {
            const n = report.findings.filter((f: Report) => f.severity === sev).length;
            const cap = { critical: 20, high: 45, medium: 70, low: 90 }[sev];
            const sets = s.cappedBy === sev;
            return (
              <div key={sev} className="row" style={{ fontSize: 14, gap: 12, padding: "6px 8px", borderRadius: 8, background: sets ? "rgba(255,107,112,0.08)" : "transparent" }}>
                <span className={`sev sev-${sev}`}>{SEVERITY_LABEL[sev]}</span>
                <span style={{ flex: 1 }}>{n === 0 ? "None proven" : `${n} proven${sets ? ", this sets the cap" : ""}`}</span>
                <span className="mono muted">cap {cap}</span>
              </div>
            );
          })}
          <p className="muted" style={{ fontSize: 13 }}>Score is the lower of Depth and the cap from the worst proven finding. Leads never count.</p>
        </div>
      </section>

      <section className="stack">
        <h2>{report.findings.length === 0 ? "No proven findings" : plural(report.findings.length, "proven finding")}</h2>
        {report.findings.length === 0 ? (
          <p className="quiet">Every attack in this run failed. That means the program survived these attacks, not that it has no bugs.</p>
        ) : null}
        {report.findings.map((f: Report) => (
          <article key={f.id} className="panel stack" style={{ gap: 14, borderColor: f.severity === "critical" ? "rgba(255,107,112,0.4)" : undefined }}>
            <div className="row" style={{ gap: 12 }}>
              <span className={`sev sev-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
              <h3 style={{ fontSize: 19, flex: "1 1 320px" }}>{f.title}</h3>
              <span className="mono muted" style={{ fontSize: 13 }}>{f.id}</span>
            </div>
            <p className="quiet" style={{ maxWidth: 820 }}>{f.summary}</p>
            <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
              <div className="stack" style={{ flex: "1 1 360px", gap: 8 }}>
                <h3 style={{ fontSize: 14 }} className="muted">The attack, in order</h3>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
                  {f.steps.map((step: Report, i: number) => (
                    <li key={i} style={{ color: i >= f.attackFrom ? "var(--text)" : "var(--text-3)" }}>
                      <code>{step.ix}</code>
                      {step.args?.length ? <span className="mono muted"> ({step.args.map(String).join(", ")})</span> : null}
                      {" "}by the {step.payer}{i < f.attackFrom ? ", setup" : ""}
                    </li>
                  ))}
                </ol>
              </div>
              <table className="data" style={{ flex: "1 1 360px" }}>
                <thead><tr><th>Account</th><th style={{ textAlign: "right" }}>Before</th><th style={{ textAlign: "right" }}>After</th></tr></thead>
                <tbody>
                  {f.evidence.balances.filter((b: Report) => b.before !== b.after).map((b: Report) => (
                    <tr key={b.address}>
                      <td>{accountName(b.account)}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{sol(b.before)}</td>
                      <td className="mono" style={{ textAlign: "right", color: BigInt(b.after) > BigInt(b.before) && /attacker|loot/.test(b.account) ? "var(--critical)" : undefined }}>{sol(b.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 14 }}><strong>Fix: </strong><span className="quiet">{f.fix}</span></p>
            <details>
              <summary className="muted" style={{ fontSize: 14 }}>The attack transaction and logs</summary>
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                <pre className="code">{f.evidence.transaction}</pre>
                <pre className="code">{f.evidence.logs.join("\n")}</pre>
                <p className="muted" style={{ fontSize: 13 }}>
                  Replay it locally with the report JSON: clone github.com/Verafyai/fuzzy, then <code>npm run fuzzy -- replay report.json {f.id} --program your_program.so --idl idl.json</code>
                </p>
              </div>
            </details>
          </article>
        ))}
      </section>

      {report.leads.length ? (
        <details className="panel">
          <summary style={{ fontWeight: 600 }}>{plural(report.leads.length, "lead")} checked and not counted</summary>
          <ul className="list" style={{ marginTop: 12, fontSize: 14 }}>
            {report.leads.map((l: Report, i: number) => (
              <li key={i}><span>{l.title}.</span> <span className="muted">{l.detail}</span></li>
            ))}
          </ul>
        </details>
      ) : null}

      <section className="stack">
        <h2>Attack classes</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          {report.tested.classes.map((c: Report) => (
            <div key={c.id} className="panel row" style={{ padding: "12px 14px", justifyContent: "space-between", fontSize: 14 }}>
              <span>{c.name}</span>
              <span style={{ color: c.status === "broke it" ? "var(--critical)" : c.status === "held" ? "var(--teal)" : "var(--text-4)", fontWeight: c.status === "broke it" ? 600 : 400 }}>{c.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel stack" style={{ gap: 8 }}>
        <h2>About this run</h2>
        <ul className="list quiet" style={{ fontSize: 14 }}>
          {report.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
        </ul>
      </section>
    </div>
  );
}

function headline(report: Report) {
  const s = report.score;
  if (report.findings.length === 0 && s.depth < 50) return `Fuzzy could only reach a depth of ${s.depth}, too shallow to judge this program. Nothing it tried broke, but it could not try enough. See what was tested below.`;
  if (s.cappedBy) return `Fuzzy tested it to a depth of ${s.depth}, and a proven ${s.cappedBy} finding caps the score at ${s.ceiling}. Fix it and run again to lift the cap.`;
  if (report.findings.length === 0) return `Every attack in this run failed. The score is the depth Fuzzy reached: ${s.depth} of 100.`;
  return `Fuzzy tested it to a depth of ${s.depth}.`;
}

function depthNotes(report: Report): Record<string, string> {
  const ixs = report.tested.instructions || [];
  const covered = ixs.filter((i: Report) => i.succeeded && i.failed).length;
  const classes = report.tested.classes.filter((c: Report) => c.status !== "does not apply");
  const tried = classes.filter((c: Report) => c.status === "held" || c.status === "broke it").length;
  return {
    branchCoverage: "Not measured in this engine version",
    instructionCoverage: ixs.length ? `${covered} of ${ixs.length} instructions driven to both success and failure` : "No IDL, so instructions are unknown",
    attackClasses: `${tried} of ${classes.length} classes that apply to this program`,
    realState: report.tested.state === "synthetic" ? "Synthetic accounts built from the IDL" : report.tested.state === "mainnet" ? "Cloned mainnet accounts" : "Empty accounts",
    effort: "Share of the planned run completed",
  };
}

function accountName(label: string) {
  if (label === "actor:attacker") return "Attacker";
  if (label === "new:loot") return "Attacker's wallet";
  if (label === "actor:owner") return "Owner";
  if (label.startsWith("state:")) return `Program account (${label.slice(6)})`;
  if (label.startsWith("fake:")) return `Fake ${label.slice(5)}`;
  if (label.startsWith("new:wallet-")) return `Owner's ${label.slice(11)}`;
  return label;
}
