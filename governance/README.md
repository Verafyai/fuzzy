# Fuzzy governance

Fuzzy's rules live in `charter.json`, a `verafy.charter/1` (Verafy Harness VIP-0035). Articles marked `protected` are the promises that make a score or a certification mean something: only proven findings count, a certification names one exact build, only a jury of registered harnesses certifies, nothing already issued ever changes.

## Amending the charter

1. Write a proposal in `proposals/`: a title, a rationale, and the changes (`add`, `replace` or `remove` an article).
2. Build the jury contract: `HARNESS_DIR=../verafyHarness node scripts/amend.mjs governance/proposals/<file>.json`.
3. Run it with Verafy Harness. The jury answers ADOPT only if every protected article still holds, in letter and in effect. When unsure it answers REJECT. Below the bar, it escalates to a larger jury.
4. If adopted, apply it with `applyCharterAmendment`, commit the new `charter.json` (its version goes up by one) and the sealed ruling beside the proposal.

An amendment names the hash of the charter version it changes, so two proposals cannot race. Adopted amendments apply to new runs only.

`proposals/0001-example.json` is an example, not an adopted change.
