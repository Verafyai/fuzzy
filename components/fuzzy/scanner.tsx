"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { FuzzyMascot } from "@/components/fuzzy/mascot";
import { FuzzyReport } from "@/components/fuzzy/report";
import { openBuyCredits, refreshCreditsBalance } from "@/lib/credits/client";
import { track } from "@/lib/analytics";

const COST = 100;

type Phase = "idle" | "running" | "done" | "error";
/* eslint-disable @typescript-eslint/no-explicit-any */
type Report = any;

export function Scanner() {
  const [program, setProgram] = useState<File | null>(null);
  const [idl, setIdl] = useState<File | null>(null);
  const [address, setAddress] = useState("");
  useEffect(() => {
    // ?program=<address> prefills the address, for links from agents and the MCP server.
    const p = new URLSearchParams(window.location.search).get("program");
    if (p && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p)) setAddress(p);
  }, []);
  const [network, setNetwork] = useState<"mainnet" | "devnet">("mainnet");
  const [addVerified, setAddVerified] = useState(false);
  const [addAdvisories, setAddAdvisories] = useState(false);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [feed, setFeed] = useState<string[]>([]);
  const [transactions, setTransactions] = useState(0);
  const [found, setFound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addressValid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim());
  // Source add-ons need a deployed mainnet program; advisories include the verified-source check.
  const addonsOn = !program && network === "mainnet";
  const addons = addonsOn ? [...(addVerified || addAdvisories ? ["verified"] : []), ...(addAdvisories ? ["advisories"] : [])] : [];
  const total = COST + (addons.includes("verified") ? 25 : 0) + (addons.includes("advisories") ? 100 : 0);
  const ready = phase !== "running" && (program !== null || addressValid);

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

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setPhase("running");
    setFeed([]);
    setTransactions(0);
    setFound(0);
    setError(null);
    setReport(null);
    track("fuzzy_run_start", { tier: "sniff", input: program ? "file" : "address", has_idl: Boolean(idl) });
    let response: Response;
    try {
      if (program) {
        const form = new FormData();
        form.set("program", program);
        if (idl) form.set("idl", idl);
        response = await fetch("/api/scan", { method: "POST", body: form });
      } else {
        response = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: address.trim(), network, addons }) });
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
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        handle(JSON.parse(line));
      }
    }
    refreshCreditsBalance();
  }

  function handle(event: Report) {
    if (event.type === "charged") setFeed((f) => [...f, event.mock ? `Run started. Mock data: credits are not connected on this deploy, so nothing was spent.` : `Run started. ${total} credits spent.`]);
    if (event.type === "note") setFeed((f) => [...f, event.text]);
    if (event.type === "progress") setTransactions(event.transactions);
    if (event.type === "finding") {
      setFound((n) => n + 1);
      setFeed((f) => [...f, `Proven: ${event.finding.title}`]);
    }
    if (event.type === "report") {
      setReport(event.report);
      setPhase("done");
      track("fuzzy_run_complete", { score: event.report.score.score, grade: event.report.score.grade, proven: event.report.findings.length });
    }
    if (event.type === "error") {
      setPhase("error");
      setError(event.message);
    }
  }

  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fuzzy-${report.program.name}-${report.program.sha256.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    track("fuzzy_report_download", { grade: report.score.grade });
  }

  if (phase === "done" && report) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button type="button" className="btn btn-quiet" onClick={() => { setPhase("idle"); setReport(null); }}>Scan another program</button>
          <button type="button" className="btn btn-quiet" onClick={download}>Download report JSON</button>
        </div>
        <FuzzyReport report={report} />
      </div>
    );
  }

  return (
    <form className="stack" style={{ gap: 20 }} onSubmit={start}>
      <div
        className="drop"
        data-over={over}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <FuzzyMascot mood={phase === "running" ? (found ? "found" : "sniffing") : "waiting"} size={112} />
        <div className="stack" style={{ flex: "1 1 280px", gap: 8 }}>
          <h2>{program ? program.name : "Drop your program here"}</h2>
          <p className="muted" style={{ fontSize: 15 }}>
            {program ? `${(program.size / 1024).toFixed(1)} KB${idl ? `, with ${idl.name}` : ", no IDL yet. Drop the IDL JSON too for real attacks."}` : "A compiled .so file, plus its Anchor IDL JSON so Fuzzy knows the instructions."}
          </p>
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn btn-quiet" onClick={() => fileRef.current?.click()}>Choose files</button>
            {program || idl ? <button type="button" className="btn btn-quiet" onClick={() => { setProgram(null); setIdl(null); }}>Clear</button> : null}
          </div>
          <input ref={fileRef} type="file" accept=".so,.json" multiple hidden onChange={(e) => takeFiles(e.target.files)} />
        </div>
      </div>

      {!program ? (
        <>
          <div className="row muted mono" style={{ fontSize: 13, gap: 12 }}>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />or point it at a deployed program<span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "1 1 380px" }}>
              Program address
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Program address on Solana" spellCheck={false} autoComplete="off" />
            </label>
            <label className="field" style={{ flex: "0 1 160px" }}>
              Network
              <select className="input" value={network} onChange={(e) => setNetwork(e.target.value as "mainnet" | "devnet")}>
                <option value="mainnet">Mainnet</option>
                <option value="devnet">Devnet</option>
              </select>
            </label>
          </div>
        </>
      ) : null}

      {addonsOn ? (
        <fieldset className="addons">
          <legend>Add-ons for a deployed mainnet program</legend>
          <label><input type="checkbox" checked={addVerified || addAdvisories} disabled={addAdvisories} onChange={(e) => setAddVerified(e.target.checked)} /> <span><b>Verified-source check</b> <span className="cost">+25</span><br /><span className="muted">Is the deployed bytecode a verified build of public source? Which repository and commit? (OtterSec verification service)</span></span></label>
          <label><input type="checkbox" checked={addAdvisories} onChange={(e) => setAddAdvisories(e.target.checked)} /> <span><b>Dependency advisories</b> <span className="cost">+100</span><br /><span className="muted">Checks every crate in the verified commit&apos;s Cargo.lock against the RustSec advisory database, through OSV. Needs a verified build.</span></span></label>
          <p className="muted" style={{ fontSize: 13 }}>Coming next: rebuild from source, static lints, Deep Fuzz with branch coverage, property fuzzing and an AI design review. <a href="/method#addons">What each one does</a></p>
        </fieldset>
      ) : null}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ fontSize: 14, maxWidth: 560 }}>
          Sniff runs for up to a minute. Nothing is ever sent to mainnet: every attack runs on a local copy of Solana.
        </p>
        <div className="row" style={{ gap: 12 }}>
          <span className="cost">{total} credits</span>
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            {phase === "running" ? "Sniffing…" : "Run Sniff"}
          </button>
        </div>
      </div>

      {phase === "running" || feed.length ? (
        <section className="panel stack" aria-live="polite" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>{phase === "running" ? "Fuzzy is attacking your program" : "Run log"}</h3>
            <span className="mono muted" style={{ fontSize: 13 }}>{transactions.toLocaleString("en-US")} transactions · {found} proven</span>
          </div>
          <ul className="list" style={{ fontSize: 14 }}>
            {feed.map((line, i) => <li key={i} style={{ color: line.startsWith("Proven") ? "var(--critical)" : "var(--text-2)" }}>{line}</li>)}
          </ul>
        </section>
      ) : null}

      {phase === "error" && error ? (
        <p role="alert" className="panel" style={{ borderColor: "rgba(255,107,112,0.5)", color: "var(--text)" }}>{error}</p>
      ) : null}
    </form>
  );
}
