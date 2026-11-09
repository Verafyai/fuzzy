<p align="center"><img src="brand/fuzzy-sniffing.svg" alt="Fuzzy, a round teal bug-hunter with a magnifying glass" width="160"></p>

# Fuzzy

**We break it so they can't.** Pay-per-run security fuzzing for Solana programs, at fuzzy.verafy.ai.

Drop in a compiled program or paste a program address. Fuzzy attacks it in LiteSVM, a local copy of Solana, and reports only what it actually broke, with the transaction to prove it, and a Fuzzy Score that says how hard it tried. The plan in `SPEC.md` adds the wrapped open-source tools, model-planned attacks and deeper tiers.

Status: the Sniff tier runs, on the CLI and at fuzzy.verafy.ai (once deployed). Deep Fuzz and Kitchen Sink are not built.

## Run it

```
npm install
npm test                      # scoring, the engine, and the benchmark vault
npm run fuzzy -- run bench/example_vault_vulnerable.so --idl bench/example_vault.json
npm run fuzzy -- run <program address>          # read-only fetch from mainnet, replays recent calls
npm run dev                   # the site on localhost:3000, with a mock credits ledger
```

## What Sniff does today

- **IDL mode** (a `.so` plus its Anchor IDL): builds accounts from the IDL, learns the working paths, then attacks each one: dropped signatures, re-run initialization (with escalation), look-alike accounts owned by another program, extreme arguments.
- **History mode** (a program address): replays recent successful mainnet calls on cloned copies of the accounts they touched, then attacks each replayed call: dropped signatures and a stranger signing in the authority's place.
- A finding counts only if the attack transaction succeeds and moves SOL to the attacker or writes the attacker in as an authority. Everything else is a lead.
- Not yet: branch coverage (scores 0 of 40, so the maximum score today is 55 to 60), token balances in the proof, PDA seeds, model-planned attacks.

| Path | What |
|---|---|
| `SPEC.md` | The product spec: flows, engines, the proof layer, scoring, credits, architecture, milestones |
| `src/engine/` | The engine: ingest, the LiteSVM world, Sniff (IDL mode) and history mode |
| `bin/fuzzy.js` | CLI: `run` and `replay` |
| `app/`, `components/` | The site, on the shared Verafy header and credits |
| `bench/` | `example_vault`, deliberately vulnerable, and its fixed build, with the IDL; source in `programs/` |
| `src/score.js` | Fuzzy Score v1, reference implementation (zero dependencies, Node 22) |
| `test/score.test.js` | Tests, including the spec's worked examples (`npm test`) |
| `design/` | Design canvas sources: drop page, run, report, credits, mascot sheet (`.dc.html`) |
| `brand/` | The mascot in five moods, as SVG |

A high Fuzzy Score means a program survived these attacks. It is not an audit and not a promise of safety.
