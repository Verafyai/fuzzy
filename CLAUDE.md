# Fuzzy

fuzzy.verafy.ai: pay-per-run security fuzzing for Solana programs. The spec is `SPEC.md`; read it before building.

## Rules

- Never send a transaction to mainnet or devnet. Every attack runs in LiteSVM on local copies; ingest may only read from RPC.
- Only proven findings (reproduced in LiteSVM with a transaction attached) count toward the score. Leads are shown, never scored.
- Scoring lives in `src/score.js` and is versioned (`fuzzy-score/1`). Changing a weight or ceiling means a new version, not an edit.
- Never describe a score as "safe" or "audited". The wording is "survived", and every badge carries tier and date.
- Findings on a program the user doesn't own go only to that user, with a disclosure notice.
- Credits are a prepaid account balance, not a token. No token, ever.
- No secrets in git. Stripe, RPC and model keys come from the environment.
- Copy: no em or en dashes. No invented numbers on public pages; label estimates as estimates.

## Checks

```
npm test
```
