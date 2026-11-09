"use client";

import { useState, type FormEvent } from "react";
import { track } from "@/lib/analytics";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function CertLookup({ initial = "" }: { initial?: string }) {
  const [program, setProgram] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(program.trim());

  async function check(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setResult(null);
    const r = await fetch(`/api/certification?program=${encodeURIComponent(program.trim())}`).then((x) => x.json()).catch(() => ({ error: "Lookup failed." }));
    setResult(r);
    setBusy(false);
    track("certification_lookup", { certified: Boolean(r?.certified), level: typeof r?.level === "number" ? r.level : -1 });
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <form className="row" style={{ alignItems: "flex-end" }} onSubmit={check}>
        <label className="field" style={{ flex: "1 1 420px" }}>
          Program address (devnet)
          <input className="input" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="Program address" spellCheck={false} autoComplete="off" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>{busy ? "Checking…" : "Check certification"}</button>
      </form>
      {result ? (
        result.error ? <p role="alert" className="panel">{result.error}</p> : (
          <section className="panel stack" style={{ gap: 10, borderColor: result.certified ? "rgba(95,224,200,0.5)" : undefined }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ fontSize: 20 }}>{result.certified ? `Verafy Certified: ${result.levelName}` : "Not certified"}</h3>
              <span className="mono muted" style={{ fontSize: 13 }}>{result.reason}</span>
            </div>
            <table className="data">
              <tbody>
                <tr><td className="muted">Program</td><td className="mono" style={{ overflowWrap: "anywhere" }}>{result.program}</td></tr>
                <tr><td className="muted">Build (bytecode sha256)</td><td className="mono" style={{ overflowWrap: "anywhere" }}>{result.bytecodeHash ?? "unknown"}</td></tr>
                {typeof result.level === "number" ? (
                  <>
                    <tr><td className="muted">Fuzzy Score</td><td className="mono">{result.score}</td></tr>
                    <tr><td className="muted">Jury</td><td>{result.seats} registered harnesses, {result.families} model families</td></tr>
                    <tr><td className="muted">Ruling</td><td className="mono" style={{ overflowWrap: "anywhere" }}><a href={`https://explorer.solana.com/address/${result.ruling}?cluster=devnet`}>{result.ruling}</a></td></tr>
                    <tr><td className="muted">Report sha256</td><td className="mono" style={{ overflowWrap: "anywhere" }}>{result.reportHash}</td></tr>
                  </>
                ) : null}
                <tr><td className="muted">Certification account</td><td className="mono" style={{ overflowWrap: "anywhere" }}>{result.certificationAddress ? <a href={`https://explorer.solana.com/address/${result.certificationAddress}?cluster=devnet`}>{result.certificationAddress}</a> : "none"}</td></tr>
              </tbody>
            </table>
          </section>
        )
      ) : null}
    </div>
  );
}
