"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { refreshCreditsBalance } from "@/lib/credits/client";

const ADDONS = [
  { id: "rebuild", name: "Rebuild from source", credits: 500, needsSource: true, what: "Rebuilds the verified commit and checks the build matches the deployed bytecode byte for byte." },
  { id: "lints", name: "Static lints", credits: 300, needsSource: true, what: "Trail of Bits solana-lints and Clippy over the verified source." },
  { id: "deep", name: "Deep Fuzz", credits: 1000, needsSource: false, what: "Four times the mainnet history, five times the budget, and branch coverage traced instruction by instruction." },
  { id: "property", name: "Property fuzzing", credits: 1500, needsSource: false, what: "Random multi-user call sequences, with invariants from the IDL checked after every transaction." },
  { id: "review", name: "AI design review", credits: 1000, needsSource: true, what: "A jury of four models from different labs reads the source for design and economic risk. Not a human audit." },
] as const;
const SINK = 4000;

export function BuildMachine({ address: fixedAddress, verified }: { address?: string; verified?: boolean }) {
  const [address, setAddress] = useState(fixedAddress || "");
  const [picked, setPicked] = useState<string[]>([]);
  const [sink, setSink] = useState(false);
  const [idl, setIdl] = useState<unknown>(null);
  const [state, setState] = useState<"idle" | "sending" | "waiting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [job, setJob] = useState<any>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then((j) => setConnected(Boolean(j.configured))).catch(() => setConnected(false));
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim());
  const usable = (a: (typeof ADDONS)[number]) => !(a.needsSource && verified === false);
  const jobs = sink ? ["sink"] : picked;
  const total = sink ? SINK : ADDONS.filter((a) => picked.includes(a.id)).reduce((s, a) => s + a.credits, 0);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function start() {
    setState("sending"); setMessage(null); setJob(null);
    const res = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: address.trim(), jobs, idl }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setState("error"); setMessage(j.error || "Could not start the job."); if (res.status === 402) window.dispatchEvent(new CustomEvent("verafy-credits:open", { detail: { outOfCredits: true } })); return; }
    refreshCreditsBalance();
    setState("waiting");
    setMessage(`Running on the build machine: ${j.jobs.join(", ")}. ${j.charged.toLocaleString("en-US")} credits spent.${j.skipped?.length ? ` Skipped, not charged: ${j.skipped.map((s: any) => s.job).join(", ")} (no verified source).` : ""} This takes a few minutes; you can leave this page open.`);
    const poll = async () => {
      const r = await fetch(`/api/jobs/${j.id}`).then((x) => x.json()).catch(() => null);
      if (!r) return;
      if (r.status === "done" || r.status === "failed") {
        if (timer.current) clearInterval(timer.current);
        setJob(r);
        setState(r.status === "done" ? "done" : "error");
        if (r.status === "failed") { setMessage(`The job failed${r.refunded ? ` and your ${r.refunded} credits were returned` : ""}. ${r.error ? String(r.error).split("\n").pop() : ""}`); refreshCreditsBalance(); }
        else setMessage(null);
      }
    };
    timer.current = setInterval(poll, 10_000);
  }

  return (
    <section className="panel stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h3>Run more checks on the build machine</h3>
        {connected === false ? <p style={{ fontSize: 14, color: "var(--medium)" }}>The build machine is being connected. These add-ons are built and will run here as soon as it is online. Nothing can be charged until then.</p> : null}
        <p className="quiet" style={{ fontSize: 14 }}>Heavier add-ons run in an isolated container with the Rust and Solana toolchains. Checks that need source run only when the program has a verified build; you are never charged for a check that cannot run.</p>
      </div>
      {!fixedAddress ? (
        <label className="field">Program address (mainnet)
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Program address on Solana" spellCheck={false} />
        </label>
      ) : null}
      <fieldset className="addons">
        <legend>Add-ons</legend>
        {ADDONS.map((a) => (
          <label key={a.id} style={{ opacity: usable(a) ? 1 : 0.5 }}>
            <input type="checkbox" disabled={sink || !usable(a)} checked={sink || picked.includes(a.id)} onChange={() => toggle(a.id)} />
            <span><b>{a.name}</b> <span className="cost">+{a.credits.toLocaleString("en-US")}</span><br /><span className="muted">{a.what}{!usable(a) ? " Not available: no verified build on record." : ""}</span></span>
          </label>
        ))}
        <label>
          <input type="checkbox" checked={sink} onChange={(e) => setSink(e.target.checked)} />
          <span><b>Kitchen Sink</b> <span className="cost">{SINK.toLocaleString("en-US")}</span><br /><span className="muted">Everything above in one run, for less than the parts. Needed for the Hardened level.</span></span>
        </label>
        <label className="field" style={{ display: "block" }}>
          <span className="muted">Anchor IDL (optional, for programs that do not publish one): </span>
          <input type="file" accept=".json" onChange={async (e) => { const f = e.target.files?.[0]; setIdl(f ? JSON.parse(await f.text()) : null); }} />
        </label>
      </fieldset>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ fontSize: 13 }}>{message}</p>
        <div className="row" style={{ gap: 12 }}>
          <span className="cost">{total.toLocaleString("en-US")} credits</span>
          <button className="btn btn-primary" type="button" disabled={!connected || !valid || !jobs.length || state === "sending" || state === "waiting"} onClick={start}>
            {state === "waiting" ? "Running…" : "Run add-ons"}
          </button>
        </div>
      </div>
      {job?.result ? <JobResults result={job.result} /> : null}
    </section>
  );
}

export function JobResults({ result: r }: { result: any }) {
  const pct = (x: number) => `${Math.round((x || 0) * 100)}%`;
  return (
    <div className="stack" style={{ gap: 18 }}>
      {r.rebuild ? (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Rebuild from source</h3>
          {r.rebuild.ran === false ? <p className="quiet">{r.rebuild.reason}</p> : (
            <p className="quiet"><span className="tag" style={{ color: r.rebuild.match ? "var(--teal)" : "var(--medium)" }}>{r.rebuild.match ? "Matches" : "No match"}</span> {r.rebuild.note || r.rebuild.error} Deployed hash <code>{String(r.rebuild.onChainHash).slice(0, 16)}…</code>; {r.rebuild.built?.length || 0} programs built from <a href={`https://github.com/${r.rebuild.repo}/tree/${r.rebuild.commit}`}>{r.rebuild.repo}</a> in {r.rebuild.seconds}s.</p>
          )}
        </div>
      ) : null}
      {r.lints ? (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Static lints</h3>
          {r.lints.ran === false ? <p className="quiet">{r.lints.reason}</p> : (
            <>
              <p className="quiet">{r.lints.total} findings. {Object.entries(r.lints.byLint || {}).map(([k, v]) => `${k} ${v}`).join(", ")}</p>
              {r.lints.findings?.length ? <div className="tablewrap"><table className="data"><thead><tr><th>Lint</th><th>Where</th><th>Message</th></tr></thead><tbody>{r.lints.findings.slice(0, 40).map((f: any, i: number) => <tr key={i}><td className="mono" style={{ fontSize: 12 }}>{f.lint}</td><td className="mono muted" style={{ fontSize: 12 }}>{f.file}:{f.line}</td><td className="quiet" style={{ fontSize: 13 }}>{f.message}</td></tr>)}</tbody></table></div> : null}
            </>
          )}
        </div>
      ) : null}
      {r.deep ? (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Deep Fuzz</h3>
          {r.deep.ran === false ? <p className="quiet">{r.deep.reason}</p> : (
            <p className="quiet">Fuzzy Score <b>{r.deep.score?.score}</b> ({r.deep.findings?.length || 0} proven, {r.deep.leads?.length || 0} leads, {r.deep.tested?.transactions} transactions). Branch coverage {typeof r.deep.tested?.branchCoverage === "object" ? `${r.deep.tested.branchCoverage.branchesTaken} of ${r.deep.tested.branchCoverage.branches} branch outcomes (${pct(r.deep.tested.branchCoverage.branchCoverage)})` : "not measured"}. Depth {r.deep.score?.depth}.</p>
          )}
        </div>
      ) : null}
      {r.property ? (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Property fuzzing</h3>
          {r.property.ran === false ? <p className="quiet">{r.property.reason}</p> : (
            <>
              <p className="quiet">{r.property.sequencesRun} sequences, {r.property.transactions} transactions. {r.property.invariants.filter((i: any) => i.held).length} of {r.property.invariants.length} invariants held.</p>
              <ul className="list quiet" style={{ fontSize: 14 }}>{r.property.invariants.map((i: any) => <li key={i.id}><span className="status" style={{ color: i.held ? "var(--teal)" : "var(--critical)" }}>{i.held ? "held" : "broken"}</span> {i.description}</li>)}</ul>
              {r.property.violations?.slice(0, 5).map((v: any, i: number) => <pre key={i} className="code">{`${v.invariant}: ${v.from} -> ${v.to || ""}\n${v.sequence.map((s: any) => `${s.actor}:${s.ix}${s.ok ? "" : " (failed)"}`).join("  >  ")}\nseed ${v.seed}`}</pre>)}
            </>
          )}
        </div>
      ) : null}
      {r.review ? (
        <div className="stack" style={{ gap: 6 }}>
          <h3>AI design review</h3>
          {r.review.ran === false ? <p className="quiet">{r.review.reason}</p> : (
            <>
              <p className="quiet">{r.review.jurors.filter((j: any) => j.answered).length} of {r.review.jurors.length} jurors answered, reviewing {r.review.filesReviewed} files. {r.review.agreed.length} risks raised by two or more jurors. {r.review.note}</p>
              {r.review.agreed.length ? <div className="tablewrap"><table className="data"><thead><tr><th>Risk</th><th>Where</th><th style={{ textAlign: "center" }}>Jurors</th><th style={{ textAlign: "center" }}>Severity</th></tr></thead><tbody>{r.review.agreed.map((g: any, i: number) => <tr key={i}><td>{g.title}<div className="quiet" style={{ fontSize: 13 }}>{g.why}</div></td><td className="mono muted" style={{ fontSize: 12 }}>{g.file} {g.function}</td><td className="mono" style={{ textAlign: "center" }}>{g.jurors}</td><td style={{ textAlign: "center" }}>{g.severity}</td></tr>)}</tbody></table></div> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
