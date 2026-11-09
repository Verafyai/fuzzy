<p align="center"><img src="brand/fuzzy-sniffing.svg" alt="Fuzzy, a round teal bug-hunter with a magnifying glass" width="160"></p>

# Fuzzy

**We break it so they can't.** Pay-per-run security fuzzing for Solana programs, at fuzzy.verafy.ai.

Drop in a compiled program or paste a program address. Fuzzy runs every good open fuzzer and scanner at once, has a model turn every lead into a real attack, and replays each attack in LiteSVM against cloned mainnet state. It reports only what it actually broke, with the transaction to prove it, and a Fuzzy Score that says how hard it tried.

Status: spec and designs. Nothing runs yet beyond the reference scoring module.

| Path | What |
|---|---|
| `SPEC.md` | The product spec: flows, engines, the proof layer, scoring, credits, architecture, milestones |
| `src/score.js` | Fuzzy Score v1, reference implementation (zero dependencies, Node 22) |
| `test/score.test.js` | Tests, including the spec's worked examples (`npm test`) |
| `design/` | Design canvas sources: drop page, run, report, credits, mascot sheet (`.dc.html`) |
| `brand/` | The mascot in five moods, as SVG |

A high Fuzzy Score means a program survived these attacks. It is not an audit and not a promise of safety.
