"use client";

import { useEffect, useState } from "react";

/** A looping walkthrough of one real run: Fuzzy's fixed benchmark vault, from bytecode to its devnet certification. */
const STEPS: { t: string; where: "fuzzy" | "devnet"; lines: string[] }[] = [
  { t: "Ingest", where: "fuzzy", lines: ["getAccountInfo 9LdW…5ve (devnet)", "ELF sha256 4fe93926…ec696", "Anchor IDL: 3 instructions"] },
  { t: "Learn", where: "fuzzy", lines: ["owner, stranger, attacker: 10 SOL each", "initialize as owner: ok", "deposit 1 SOL, withdraw: ok"] },
  { t: "Replay", where: "fuzzy", lines: ["getSignaturesForAddress: recent calls", "this test vault has none to replay", "attacks run on accounts built from the IDL"] },
  { t: "Attack", where: "fuzzy", lines: ["withdraw without owner signature", "initialize again as a stranger", "u64::MAX amounts, look-alike accounts"] },
  { t: "Prove", where: "fuzzy", lines: ["measure every account's SOL before and after", "attacker gained nothing beyond fees paid", "0 proven, every attack held"] },
  { t: "Grade", where: "fuzzy", lines: ["Depth 55 = 20 + 20 + 5 + 10", "cap 100 (nothing proven)", "Fuzzy Score 55"] },
  { t: "Jury", where: "devnet", lines: ["4 registered harnesses, 4 families", "commit, then reveal: SNIFFED x4", "ruling AbgeVBT8… sealed"] },
  { t: "Imprint", where: "devnet", lines: ["verafy_certification: checks ruling", "writes [cert, program, bytecode]", "8vSDoA5k…: certified Sniffed"] },
];

export function HowItWorks() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
    if (reduce || paused) return;
    const id = setInterval(() => setI((n) => (n + 1) % STEPS.length), 2200);
    return () => clearInterval(id);
  }, [paused]);
  const s = STEPS[i];
  return (
    <div className="hiw panel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="hiw-track" role="tablist" aria-label="How a run works">
        <div className="hiw-line"><span style={{ width: `${(i / (STEPS.length - 1)) * 100}%` }} /></div>
        {STEPS.map((x, n) => (
          <button key={x.t} type="button" role="tab" aria-selected={n === i} className="hiw-node" data-on={n <= i} data-devnet={x.where === "devnet"} onClick={() => { setI(n); setPaused(true); }}>
            <span className="dot">{n + 1}</span>
            <span className="lbl">{x.t}</span>
          </button>
        ))}
      </div>
      <div className="hiw-body" key={i}>
        <div className="row" style={{ gap: 10, justifyContent: "space-between" }}>
          <h3>{i + 1}. {s.t}</h3>
          <span className="tag" style={{ color: s.where === "devnet" ? "var(--teal)" : "var(--text-2)" }}>{s.where === "devnet" ? "On Verafy Devnet" : "In Fuzzy (LiteSVM)"}</span>
        </div>
        <pre className="hiw-log">{s.lines.map((l, n) => <span key={l} style={{ animationDelay: `${n * 350}ms` }}>{`> ${l}\n`}</span>)}</pre>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>A real run: Fuzzy&apos;s fixed benchmark vault on devnet, certified Sniffed. Its jurors voted by script. Hover to pause, or click a step.</p>
    </div>
  );
}
