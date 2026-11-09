# Fuzzy: product spec

fuzzy.verafy.ai. Pay-per-run security fuzzing for Solana programs. Drop in a program or paste its address, spend Verafy Credits, and get back only the bugs Fuzzy could actually exploit, each with a transaction that reproduces it.

Living version of this spec, with the architecture diagram: https://claude.ai/artifact/UPUT5subScnvA4ph34ZiFZ
Designs (mascot, drop page, run, report, credits): https://claude.ai/artifact/KEALir34gzrdn7u7MvfFqN, sources in `design/`.

## 1. Why

**How the field got here.** Solana security has three layers. Manual audits (OtterSec, Neodyme, Zellic) are the standard but are booked weeks ahead and cost tens of thousands of dollars. Open-source tools came next: Trident for fuzzing Anchor programs, FuzzDelSol for raw bytecode, Semgrep rules and `cargo audit` for hygiene. Most recently, AI reviewers (Almanax, Octane, Sec3, Trident Arena) read code and flag likely bugs.

**The gap.** Every one of those tools leaves the last mile to the developer. Trident needs a hand-written harness. Static and AI reviewers produce long lists of possible issues, most of them false alarms. Nobody offers a self-serve service that takes a deployed program, attacks it with everything, and reports only what it proved.

**What changed.**
- LiteSVM runs real Solana transactions in-process against real bytecode, with mainnet accounts cloned in, so every guess can be checked exactly and cheaply.
- Models can plan attacks. On Ethereum, model-guided fuzzing (EchoFuzz, ICSE 2026, https://arxiv.org/pdf/2609.14475) reached 29% to 59% more branch coverage than established fuzzers and found 37 new vulnerabilities where they found 13 and 15.
- Verafy already hashes and anchors results on Solana, so a run can be sealed into a verifiable report.

## 2. User flows

Start a run:
1. Drag in a compiled `.so` (IDL JSON optional), or paste a program address and pick mainnet or devnet. For an address, Fuzzy fetches the deployed bytecode and the on-chain IDL itself (what `solana program dump` does).
2. Fuzzy sizes it up in seconds: size, loader, upgradeable or not, instructions, and the mainnet accounts it will clone (found from the program's recent transactions).
3. Pick a tier. Each button shows its credit cost. Default: Deep Fuzz.
4. Sign in (Google, email or Solana wallet). New accounts get 1,000 free credits. The run's cost is held, not spent, until it ends.
5. Live view: one lane per engine, coverage climbing, leads arriving, proven findings popping out. The tab can be closed; an email arrives at the end.

Read the report: the Fuzzy Score with depth and the worst finding; proven findings worst first (title, attack class, steps, exact transaction, before and after balances, a one-line replay command, the fix); leads not proven, folded; what was tested; the seal and an embeddable badge.

Credits page: four packs, paid by card. Watch mode: re-run automatically when a watched program is upgraded.

## 3. The engine

Six engines in parallel; LiteSVM decides what is real.

| Engine | Runs | Catches |
|---|---|---|
| Hygiene | `cargo audit`, Clippy, Semgrep Solana rules (source runs only) | Vulnerable dependencies, unchecked arithmetic |
| Static | Open-source Soteria; Sec3 X-ray if licensed | Missing signer and owner checks, unchecked CPI |
| Coverage fuzzing | Trident harnesses generated from the IDL; a bytecode fuzzer on LiteSVM | Crashes, panics, broken invariants, compute exhaustion |
| Model-guided attacks | A model that plans multi-step attacks | Logic bugs no rule describes |
| Invariant writer | A model that writes properties, which the fuzzer tries to violate | Accounting bugs |
| Attacker swarm (Kitchen Sink) | Several goal-driven attacker agents sharing partial wins | Chained exploits |

**The proof layer.** For every lead: merge duplicates, have the model write a concrete attack (accounts, signers, transactions), run it in LiteSVM against the program and cloned state. If it does what the lead claimed, it is a proven finding with the transaction attached. If not, it stays a lead, shown but never scored.

**Attack classes (12):** missing signer check, missing owner check, account substitution, PDA seed collision or non-canonical bump, arithmetic overflow or precision loss, close then reuse, unchecked CPI target, unchecked mint or authority, lamport draining, reinitialization, price manipulation through cloned pools, compute exhaustion.

**Tiers:**

| Tier | Engines | Time | State | Credits |
|---|---|---|---|---|
| Sniff | Hygiene, static, 10 min fuzz | about 15 min | Empty accounts | 100 |
| Deep Fuzz | All but the swarm | about 1 hour | Cloned mainnet | 500 |
| Kitchen Sink | All six | up to 4 hours | Cloned mainnet, several setups | 2,500 |
| Watch | Deep Fuzz on each upgrade | | | 300 per re-run |

**Safety.** Never send a transaction to mainnet or devnet. For programs the user doesn't own, findings go only to that user, with a disclosure notice pointing at the program's security contact.

## 4. Scoring (Fuzzy Score v1)

Implemented in `src/score.js`, tested in `test/score.test.js`.

```
Fuzzy Score = min(Depth, Ceiling(worst proven finding))
```

| Severity | Solana meaning | Ceiling |
|---|---|---|
| Critical | Anyone can steal or permanently lock funds, or seize an authority | 20 |
| High | Funds at risk under realistic conditions, or access control bypassed | 45 |
| Medium | An invariant breaks without direct loss: griefing, stuck account, compute exhaustion | 70 |
| Low | Hygiene: vulnerable dependency, unreachable unchecked arithmetic | 90 |
| None proven | | 100 |

| Depth part | Weight | Measured as |
|---|---|---|
| Branch coverage | 40 | Share of sBPF branches executed (LiteSVM trace) |
| Instruction coverage | 20 | Share of instructions driven to success and to their error paths |
| Attack classes tried | 20 | Classes attacked / classes that apply |
| Real state | 10 | Mainnet clone 10, synthetic 5, empty 0 |
| Effort | 10 | Time and transactions against the tier budget |

Grades: 90+ Hardened, 75 Solid, 50 Shaky, 25 Exposed, below 25 Broken. The mascot's mood follows the grade.

Rules: a score is tied to one bytecode hash and goes stale on upgrade; the badge always shows tier and date; weights are versioned; fixed findings stay in the next report's history.

## 5. Credits

Fuzzy uses the shared Verafy credits system, the same one as Swarm Explorer and the other product sites: the shared ledger at www.verafy.ai/api/credits, the visitor cookie on `.verafy.ai`, the shared header badge, checkout and packs. New visitors get 1,000 free credits once, across all Verafy products. Fuzzy spends from the `shared` product with source `fuzzy`.

| Tier | Credits | Status |
|---|---|---|
| Sniff | 100 | Live |
| Deep Fuzz | 500 (proposed) | Not built |
| Kitchen Sink | 2,500 (proposed) | Not built |

The program is fetched and checked before credits are spent; a run that fails in the engine is refunded.

## 6. Architecture

Program in → ingest (fetch bytecode and IDL, clone mainnet accounts) → credits hold → queue → one isolated worker container per run with six engines → merge leads → proof layer (LiteSVM replay) → Fuzzy Score, credits settled → report, hash anchored on Solana.

Site and API: Next.js on Vercel, Postgres (accounts, runs, ledger), Stripe. Workers: containers on a job host such as Fly.io (runs outlast Vercel functions), no outbound network beyond the read-only fetch at ingest. Object storage for uploads and reports. Seal: Memo anchoring as devnet.verafy.ai does.

## 7. Mascot and brand

Fuzzy: a round, fluffy bug-hunter in Verafy teal (#4FD1B5, shade #2BA88E, belly #9BEBD8) with big eyes, two amber-tipped antennae, a tuft and stubby feet, no arms so it reads at 16 px. Moods: waiting, sniffing (magnifying glass), found (fur on end, holding a bug), hardened (happy, shield), broken (spiral eyes). SVGs in `brand/`. Product UI: dark ground #0B0D10, Space Grotesk headings, Inter body, JetBrains Mono numbers, amber #F5B84B for findings and credits. Severity colours: Critical #FF6B70, High #FF8A3D, Medium #F5B84B, Low #AEB6BF. Tagline: "We break it so they can't."

## 8. Milestones

1. **M1, ingest and Sniff.** Address and `.so` intake, bytecode and IDL fetch, LiteSVM harness, hygiene and static engines, plain report. Done when a pasted mainnet address produces a Sniff report end to end.
2. **M2, proof layer.** Model-guided attacks, lead merging, replay on cloned mainnet state, proven versus lead. Done when Fuzzy rediscovers at least two known, already-fixed bugs by running the old vulnerable versions. Measure real cost per run; set prices.
3. **M3, score, credits, UI.** Fuzzy Score v1, live run view, sign-in, free grant, Stripe packs, ledger. Done when a stranger can drop, pay and get a scored report unaided.
4. **M4, Kitchen Sink and Watch.** Attacker swarm, invariant writer, upgrade watching, email.
5. **M5, seal and launch.** Anchored report hashes, badges, a public benchmark of which known bugs Fuzzy found and missed, launch post.

## 9. Risks

- A clean score read as "audited": say "survived", always show tier and date, state that no findings is not proof of safety.
- Attacks on programs the user doesn't control: local copies only, private findings, disclosure notice, possible rate limits on Kitchen Sink.
- Model costs: measure in M2, cap model calls per tier.
- Licenses of wrapped tools: confirm each allows a paid hosted service; X-ray by partnership or not at all.
- Incumbents: FuzzLand (Solayer) or a hosted Trident. The proof layer and the public benchmark are the edge.

Open questions: Watch as a subscription or per upgrade; public-by-default reports for free accounts; referral share for auditors.
