"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { FuzzyMascot } from "@/components/fuzzy/mascot";
import { FuzzyReport } from "@/components/fuzzy/report";
import { Modal } from "@/components/fuzzy/modal";
import { JobResults } from "@/components/fuzzy/build-machine";
import { openBuyCredits, refreshCreditsBalance } from "@/lib/credits/client";
import { track } from "@/lib/analytics";
import { ASSESSMENTS } from "@/lib/assessments";

const COST = 100;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Addon = { id: string; name: string; credits: number; what: string };
const QUICK: Addon[] = [
  { id: "verified", name: "Verified source", credits: 25, what: "Was this bytecode built from public source? Which repo and commit?" },
  { id: "advisories", name: "Dependency advisories", credits: 100, what: "Every crate in the verified Cargo.lock against RustSec." },
];
const MACHINE: Addon[] = [
  { id: "rebuild", name: "Rebuild from source", credits: 500, what: "Rebuilds the verified commit and matches it to the deployed bytes." },
  { id: "lints", name: "Static lints", credits: 300, what: "Trail of Bits solana-lints and Clippy over the source." },
  { id: "deep", name: "Deep Fuzz", credits: 1000, what: "Five times the budget, plus measured branch coverage." },
  { id: "property", name: "Property fuzzing", credits: 1500, what: "Random multi-user sequences, invariants checked every step." },
  { id: "review", name: "AI design review", credits: 1000, what: "Four models from different labs read the source. Not a human audit." },
];
const SINK = 4000;

const STEPS = [
  ["Confirm the exact build", "Verifiable builds, by hand", "Hashes the deployed bytecode and reads the upgrade authority."],
  ["Look for known bug patterns", "Static scanners", "Targets the same patterns, but proves each with a transaction."],
  ["Write the attacks", "A hand-written fuzz harness", "Generated from the IDL. Nothing to write."],
  ["Test against real state", "Manual mainnet forks", "Replays recent mainnet calls on cloned accounts."],
  ["Get a verdict others trust", "An audit report", "Fuzzy Score, an AI jury, and a record on Verafy Devnet."],
];

type Phase = "idle" | "running" | "done" | "error";

function Tile({ a, on, disabled, note, onClick }: { a: Addon; on: boolean; disabled?: boolean; note?: string; onClick: () => void }) {
  return (
    <button type="button" className="tile" aria-pressed={on} disabled={disabled} onClick={onClick}>
      <span className="tile-top"><b>{a.name}</b><span className="cost">+{a.credits.toLocaleString("en-US")}</span></span>
      <span className="tile-what">{note || a.what}</span>
      <span className="tile-check" aria-hidden="true">{on ? "✓" : ""}</span>
    </button>
  );
}

export function Scanner() {
  const [program, setProgram] = useState<File | null>(null);
  const [idl, setIdl] = useState<File | null>(null);
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState<"mainnet" | "devnet">("mainnet");
  const [picked, setPicked] = useState<string[]>([]);
  const [sink, setSink] = useState(false);
  const [addonsOpen, setAddonsOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [machine, setMachine] = useState<boolean | null>(null);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [feed, setFeed] = useState<string[]>([]);
  const [transactions, setTransactions] = useState(0);
  const [found, setFound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  const [job, setJob] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // ?program=<address> prefills the address, for links from agents and the MCP server.
    const p = new URLSearchParams(window.location.search).get("program");
    if (p && ADDRESS.test(p)) setAddress(p);
    fetch("/api/jobs").then((r) => r.json()).then((j) => setMachine(Boolean(j.configured))).catch(() => setMachine(false));
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const deployed = !program && network === "mainnet";
  const quick = deployed ? QUICK.filter((a) => picked.includes(a.id) || (a.id === "verified" && picked.includes("advisories"))).map((a) => a.id) : [];
  const heavy = deployed && machine ? (sink ? ["sink"] : MACHINE.filter((a) => picked.includes(a.id)).map((a) => a.id)) : [];
  const heavyCost = sink ? SINK : MACHINE.filter((a) => heavy.includes(a.id)).reduce((s, a) => s + a.credits, 0);
  const total = COST + QUICK.filter((a) => quick.includes(a.id)).reduce((s, a) => s + a.credits, 0) + heavyCost;
  const count = quick.length + (sink ? 1 : heavy.length);
  const ready = phase !== "running" && (program !== null || ADDRESS.test(address.trim()));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function takeFiles(files: FileList | null) {
    for (const file of Array.from(files || [])) {
      if (/\.so$/i.test(file.name)) setProgram(file);
      else if (/\.json$/i.test(file.name)) setIdl(file);
    }
  }
  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    takeFiles(event.dataTransfer.files);
  }

  async function startJobs(addr: string) {
    if (!heavy.length) return;
    let idlJson: unknown = null;
    try { idlJson = idl ? JSON.parse(await idl.text()) : null; } catch {}
    const res = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr, jobs: heavy, idl: idlJson }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setJobNote(j.error || "The build machine did not start."); return; }
    refreshCreditsBalance();
    setJobNote(`On the build machine: ${j.jobs.join(", ")}. ${j.charged.toLocaleString("en-US")} credits.${j.skipped?.length ? ` Skipped, not charged: ${j.skipped.map((s: any) => s.job).join(", ")} (no verified source).` : ""} This takes a few minutes.`);
    timer.current = setInterval(async () => {
      const r = await fetch(`/api/jobs/${j.id}`).then((x) => x.json()).catch(() => null);
      if (!r || (r.status !== "done" && r.status !== "failed")) return;
      if (timer.current) clearInterval(timer.current);
      if (r.status === "done") { setJob(r); setJobNote(null); }
      else { setJobNote(`The build machine job failed${r.refunded ? ` and ${r.refunded} credits were returned` : ""}.`); refreshCreditsBalance(); }
    }, 10_000);
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setPhase("running"); setFeed([]); setTransactions(0); setFound(0); setError(null); setReport(null); setJob(null); setJobNote(null);
    track("fuzzy_run_start", { tier: "sniff", input: program ? "file" : "address", has_idl: Boolean(idl), addons: count });
    let response: Response;
    try {
      if (program) {
        const form = new FormData();
        form.set("program", program);
        if (idl) form.set("idl", idl);
        response = await fetch("/api/scan", { method: "POST", body: form });
      } else {
        response = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: address.trim(), network, addons: quick }) });
      }
    } catch {
      setPhase("error");
      setError("Could not reach Fuzzy. Check your connection and try again.");
      return;
    }
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null);
      setPhase("error");
      setError(body?.error || "That run did not start.");
      if (body?.code === "out_of_credits") openBuyCredits({ outOfCredits: true });
      track("fuzzy_run_refused", { status: response.status, code: body?.code || "error" });
      return;
    }
    if (!program) startJobs(address.trim());
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) handle(JSON.parse(line));
    }
    refreshCreditsBalance();
  }

  function handle(event: any) {
    if (event.type === "charged") setFeed((f) => [...f, event.mock ? "Run started. Mock data: credits are not connected on this deploy, so nothing was spent." : "Run started."]);
    if (event.type === "note") setFeed((f) => [...f, event.text]);
    if (event.type === "progress") setTransactions(event.transactions);
    if (event.type === "finding") { setFound((n) => n + 1); setFeed((f) => [...f, `Proven: ${event.finding.title}`]); }
    if (event.type === "report") {
      setReport(event.report);
      setPhase("done");
      track("fuzzy_run_complete", { score: event.report.score.score, grade: event.report.score.grade, proven: event.report.findings.length });
    }
    if (event.type === "error") { setPhase("error"); setError(event.message); }
  }

  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fuzzy-${report.program.name}-${report.program.sha256.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const jobs = jobNote || job ? (
    <section className="panel stack" style={{ gap: 12 }}>
      {jobNote ? <p className="quiet" style={{ fontSize: 14 }}>{jobNote}</p> : null}
      {job?.result ? <JobResults result={job.result} /> : null}
    </section>
  ) : null;

  if (phase === "done" && report) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button type="button" className="btn btn-quiet" onClick={() => { setPhase("idle"); setReport(null); }}>Scan another program</button>
          <button type="button" className="btn btn-quiet" onClick={download}>Download report JSON</button>
        </div>
        <FuzzyReport report={report} />
        {jobs}
      </div>
    );
  }

  const machineNote = !deployed ? "Needs a deployed mainnet program address." : machine === false ? "The build machine is being connected. Nothing is charged until it is online." : undefined;

  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={start}>
      <div
        className="scanbox"
        data-over={over}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div className="scanbox-head">
          <FuzzyMascot mood={phase === "running" ? (found ? "found" : "sniffing") : "waiting"} size={64} />
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <h2 style={{ fontSize: 20 }}>Scan a program</h2>
            <p className="muted" style={{ fontSize: 14 }}>Paste an address, or drop a .so and its IDL anywhere in this box.</p>
          </div>
        </div>

        {program ? (
          <div className="filechip">
            <span className="mono" style={{ overflowWrap: "anywhere" }}>{program.name}{idl ? ` + ${idl.name}` : ""}</span>
            <span className="muted" style={{ fontSize: 13 }}>{idl ? "" : "Add the IDL JSON for real attacks."}</span>
            <button type="button" className="btn btn-quiet" onClick={() => { setProgram(null); setIdl(null); }}>Clear</button>
          </div>
        ) : (
          <div className="scanbox-row">
            <input className="input" style={{ flex: "1 1 260px" }} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Program address on Solana" spellCheck={false} autoComplete="off" aria-label="Program address" />
            <div className="seg" role="group" aria-label="Network">
              <button type="button" aria-pressed={network === "mainnet"} onClick={() => setNetwork("mainnet")}>Mainnet</button>
              <button type="button" aria-pressed={network === "devnet"} onClick={() => setNetwork("devnet")}>Devnet</button>
            </div>
          </div>
        )}

        <div className="scanbox-row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-quiet" onClick={() => setAddonsOpen(true)}>Add-ons{count ? ` (${count})` : ""}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setHowOpen(true)}>How it works</button>
            {!program ? <button type="button" className="btn btn-quiet" onClick={() => fileRef.current?.click()}>Upload files</button> : null}
          </div>
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            {phase === "running" ? "Sniffing…" : `Run Fuzzy · ${total.toLocaleString("en-US")} credits`}
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".so,.json" multiple hidden onChange={(e) => takeFiles(e.target.files)} />
      </div>

      {phase === "running" || feed.length ? (
        <section className="panel stack" aria-live="polite" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>{phase === "running" ? "Fuzzy is attacking your program" : "Run log"}</h3>
            <span className="mono muted" style={{ fontSize: 13 }}>{transactions.toLocaleString("en-US")} transactions, {found} proven</span>
          </div>
          <ul className="list" style={{ fontSize: 14 }}>
            {feed.map((line, i) => <li key={i} style={{ color: line.startsWith("Proven") ? "var(--critical)" : "var(--text-2)" }}>{line}</li>)}
          </ul>
        </section>
      ) : null}
      {phase === "error" && error ? <p role="alert" className="panel" style={{ borderColor: "rgba(255,107,112,0.5)", color: "var(--text)" }}>{error}</p> : null}
      {jobs}

      <Modal open={addonsOpen} onClose={() => setAddonsOpen(false)} title="Add-ons"
        footer={<><span className="cost">{total.toLocaleString("en-US")} credits total</span><button type="button" className="btn btn-primary" onClick={() => setAddonsOpen(false)}>Done</button></>}>
        <h3 className="modal-sub">Runs in seconds</h3>
        <div className="tiles">
          {QUICK.map((a) => (
            <Tile key={a.id} a={a} on={quick.includes(a.id)} disabled={!deployed || (a.id === "verified" && picked.includes("advisories"))}
              note={!deployed ? "Needs a deployed mainnet program address." : a.id === "verified" && picked.includes("advisories") ? "Included with dependency advisories." : undefined}
              onClick={() => toggle(a.id)} />
          ))}
        </div>
        <h3 className="modal-sub">Runs on the build machine <span className="muted" style={{ fontWeight: 400 }}>(a few minutes)</span></h3>
        <div className="tiles">
          {MACHINE.map((a) => <Tile key={a.id} a={a} on={sink || heavy.includes(a.id)} disabled={sink || Boolean(machineNote)} note={machineNote} onClick={() => toggle(a.id)} />)}
          <Tile a={{ id: "sink", name: "Kitchen Sink", credits: SINK, what: "Everything on the build machine in one run, for less than the parts." }} on={sink && Boolean(heavy.length)} disabled={Boolean(machineNote)} note={machineNote} onClick={() => setSink((s) => !s)} />
        </div>
        <p className="muted" style={{ fontSize: 13 }}>Checks that need source run only on a verified build; you are never charged for one that cannot run. <a href="/docs/method#addons">What each one does</a></p>
      </Modal>

      <Modal open={howOpen} onClose={() => setHowOpen(false)} title="How it works">
        <h3 className="modal-sub" style={{ marginTop: 0 }}>One pass instead of five</h3>
        <ul className="list quiet" style={{ fontSize: 14 }}>
          {STEPS.map(([s, u, f]) => <li key={s}><b style={{ color: "var(--text)" }}>{s}.</b> Usually {u.toLowerCase()}. {f}</li>)}
        </ul>
        <h3 className="modal-sub">What Fuzzy runs on every program</h3>
        <ul className="list quiet" style={{ fontSize: 14 }}>
          {ASSESSMENTS.map((a) => <li key={a.id}><b style={{ color: "var(--text)" }}>{a.name}</b>{a.built ? "" : " (planned)"}: {a.catches}</li>)}
        </ul>
        <p className="muted" style={{ fontSize: 13 }}>Nothing is ever sent to mainnet: every attack runs on a local copy of Solana. Fuzzy does not replace a human audit. <a href="/docs/method">Full method</a></p>
      </Modal>
    </form>
  );
}
